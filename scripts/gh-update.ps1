# gh-update.ps1 -- one command to publish whatever you changed to GitHub.
#
#   .\gh-update.ps1                        # commit nothing; push whatever is committed
#   .\gh-update.ps1 -Message "add feature" # commit all changes, then push
#
# What it does end to end:
#   1. shows what changed (so nothing surprising gets published)
#   2. optionally commits (skips the commit when there is nothing staged)
#   3. creates a short-lived token through the GitHub web UI (no pasting, no storage)
#   4. pushes with the credential store, then deletes the token file and credential file
#   5. verifies local HEAD == origin/main
#
# Requirements: git on PATH, Node.js, and a debuggable browser window logged in to
# GitHub -- start it once with:  node scripts\launch-gh.mjs
param(
  [string]$Message = '',
  [string]$Repo = 'xhs-search',
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$repoDir = Split-Path $scripts -Parent

Push-Location $repoDir
try {
  Write-Output '=== 1/5  what changed ==='
  $dirty = git status --porcelain
  if ($dirty) { $dirty | ForEach-Object { Write-Output "  $_" } }
  else { Write-Output '  (working tree clean)' }

  if ($Message -ne '') {
    Write-Output '=== 2/5  commit ==='
    git add -A
    $staged = git diff --cached --name-only
    if ($staged) {
      git commit -q -m $Message
      Write-Output ('  committed: ' + (git rev-parse --short HEAD))
    } else {
      Write-Output '  nothing to commit'
    }
  } else {
    Write-Output '=== 2/5  commit skipped (no -Message given) ==='
  }

  Write-Output '=== 3/5  token ==='
  node (Join-Path $scripts 'gh-pat.mjs') token
  if ($LASTEXITCODE -ne 0) { throw 'token step failed' }

  Write-Output '=== 4/5  push ==='
  $pushArgs = @((Join-Path $scripts 'gh-push.mjs'), $Repo)
  node @pushArgs
  if ($LASTEXITCODE -ne 0) { throw 'push step failed' }

  Write-Output '=== 5/5  verify ==='
  git fetch origin main -q 2>$null
  $local = git rev-parse HEAD
  $remote = git rev-parse origin/main
  if ($local -eq $remote) { Write-Output ('  in sync at ' + $local.Substring(0, 7)) }
  else { Write-Output ('  WARNING: local ' + $local.Substring(0, 7) + ' != remote ' + $remote.Substring(0, 7)) }
} finally {
  Pop-Location
  git -C $repoDir config --local --unset credential.helper 2>$null | Out-Null
  $credFile = Join-Path $env:USERPROFILE '.git-credentials'
  if (Test-Path $credFile) { Remove-Item $credFile -Force }
  $tokenFile = Join-Path $scripts '_token.txt'
  if (Test-Path $tokenFile) { Remove-Item $tokenFile -Force }
}
