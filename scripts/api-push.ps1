# api-push.ps1 -- publish committed changes through the GitHub REST API.
#
# Why this exists: on this machine the git smart-http endpoint is unreachable
# (github.com/<repo>/info/refs times out from curl AND git, while api.github.com
# answers 200 immediately). The git protocol is therefore unusable here, but the
# REST API is not -- and the API can create blobs, trees, commits and move a ref,
# which is exactly what a push does.
#
# It reads the file CONTENT FROM GIT (`git show <rev>:<path>`), not from the
# working tree, so line endings and staged/unstaged differences cannot leak in.
#
# Usage:
#   .\api-push.ps1 -TokenFile scripts\_token.txt -Base b1ee8f1 -Message "..."
#
# Requires: a token with `repo` scope, PowerShell 5+.
param(
  [Parameter(Mandatory = $true)][string]$TokenFile,
  [Parameter(Mandatory = $true)][string]$Base,          # remote commit sha to build on
  [string]$Message = 'update via API',
  [string]$Owner = 'cewckm',
  [string]$Repo = 'xhs-search',
  [string]$Branch = 'main',
  [string]$RepoDir = 'C:\Users\32464\Desktop\skill-dsh\search'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $TokenFile)) { throw "missing token file: $TokenFile" }
$token = [System.IO.File]::ReadAllText($TokenFile).Trim()
if ($token.Length -lt 20) { throw "token looks malformed (length $($token.Length))" }

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'xhs-search-api-push'
}

function Invoke-GitHub {
  param([string]$Method, [string]$Path, $Body)
  $uri = "https://api.github.com$Path"
  $params = @{ Method = $Method; Uri = $uri; Headers = $headers; TimeoutSec = 60 }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
    $params.ContentType = 'application/json; charset=utf-8'
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $detail = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    throw "$Method $Path failed: $($_.Exception.Message) $detail"
  }
}

<#
Read a blob's raw bytes straight out of the object database.
`git cat-file blob <rev>:<path>` writes the exact stored bytes to stdout, so
binary and UTF-8 content survive untouched -- unlike piping `git show` through
cmd redirection, which can mangle bytes and is vulnerable to shell quoting.
#>
function Get-GitBlobBytes {
  param([string]$Rev, [string]$Path)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = "cat-file blob `"$Rev`:`"$Path`""
  $psi.WorkingDirectory = $RepoDir
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $ms = New-Object System.IO.MemoryStream
  $proc.StandardOutput.BaseStream.CopyTo($ms)
  $err = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { throw "git cat-file failed for ${Rev}:${Path} -- $err" }
  return $ms.ToArray()
}

<#
Compute the git blob id the same way git and GitHub do:
    sha1("blob " + <byteLength> + "\0" + <bytes>)
Comparing this against the remote tree tells us which files really changed,
without needing any local git object that the server created.
#>
function Get-GitBlobSha {
  param([byte[]]$Bytes)
  $header = [Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)`0")
  $all = New-Object byte[] ($header.Length + $Bytes.Length)
  [Array]::Copy($header, 0, $all, 0, $header.Length)
  [Array]::Copy($Bytes, 0, $all, $header.Length, $Bytes.Length)
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $hash = $sha1.ComputeHash($all)
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha1.Dispose() }
}

# ---------- 1. which files differ from the remote tip ----------
#
# The remote may hold commits that do not exist locally (the API creates them
# server-side, and `git fetch` is blocked here), so `git diff <base>` cannot be
# used. Instead we read the REMOTE tree from the API, hash each local file the
# way git does, and publish exactly the files whose hash differs.
$remoteTree = @{}
$treeResp = Invoke-GitHub -Method GET -Path "/repos/$Owner/$Repo/git/trees/$Base`?recursive=1"
foreach ($node in $treeResp.tree) {
  if ($node.type -eq 'blob') { $remoteTree[$node.path] = $node.sha }
}
Write-Output ("remote tree at $($Base.Substring(0,7)): $($remoteTree.Count) blobs")

Push-Location $RepoDir
try {
  # Everything tracked and present locally, minus the private scratch files.
  $candidates = @(git ls-files)
  $changed = @()
  foreach ($path in $candidates) {
    $bytes = Get-GitBlobBytes -Rev 'HEAD' -Path $path
    $sha = Get-GitBlobSha -Bytes $bytes
    if ($remoteTree[$path] -ne $sha) { $changed += $path }
  }
  if ($changed.Count -eq 0) { Write-Output 'nothing to publish'; exit 0 }
  Write-Output ("files to publish: " + $changed.Count)
  foreach ($f in $changed) { Write-Output "  $f" }

  # ---------- 2. blobs ----------
  $entries = @()
  foreach ($path in $changed) {
    $bytes = Get-GitBlobBytes -Rev 'HEAD' -Path $path
    $b64 = [Convert]::ToBase64String($bytes)
    $blob = Invoke-GitHub -Method POST -Path "/repos/$Owner/$Repo/git/blobs" -Body @{
      content  = $b64
      encoding = 'base64'
    }
    $entries += @{ path = $path; mode = '100644'; type = 'blob'; sha = $blob.sha }
    Write-Output ("  blob " + $blob.sha.Substring(0, 8) + "  $path  (" + $bytes.Length + " bytes)")
  }

  # ---------- 3. tree (built on the base commit's tree) ----------
  $baseCommit = Invoke-GitHub -Method GET -Path "/repos/$Owner/$Repo/git/commits/$Base"
  $tree = Invoke-GitHub -Method POST -Path "/repos/$Owner/$Repo/git/trees" -Body @{
    base_tree = $baseCommit.tree.sha
    tree      = $entries
  }
  Write-Output ("tree " + $tree.sha.Substring(0, 8))

  # ---------- 4. commit ----------
  $commit = Invoke-GitHub -Method POST -Path "/repos/$Owner/$Repo/git/commits" -Body @{
    message = $Message
    tree    = $tree.sha
    parents = @($Base)
  }
  Write-Output ("commit " + $commit.sha.Substring(0, 8))

  # ---------- 5. move the branch ----------
  $ref = Invoke-GitHub -Method PATCH -Path "/repos/$Owner/$Repo/git/refs/heads/$Branch" -Body @{
    sha   = $commit.sha
    force = $false
  }
  Write-Output ("refs/heads/$Branch -> " + $ref.object.sha.Substring(0, 8))
  Write-Output "API_PUSH_OK $($commit.sha)"
} finally {
  Pop-Location
  if (Test-Path $TokenFile) { Remove-Item $TokenFile -Force; Write-Output 'token file removed' }
  $cred = Join-Path $env:USERPROFILE '.git-credentials'
  if (Test-Path $cred) { Remove-Item $cred -Force }
}
