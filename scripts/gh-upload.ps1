# gh-upload.ps1 -- publish this skill folder to GitHub for a first-time GitHub user.
#
#   .\gh-upload.ps1                 # creates <login>/xhs-search (public) and pushes
#   .\gh-upload.ps1 -RepoName foo   # different repository name
#   .\gh-upload.ps1 -Private        # private repository instead of public
#
# Requires: git on PATH, Node.js, and a browser window that is logged in to GitHub
# AND started with --remote-debugging-port=<port> (see scripts/launch-gh.mjs).
#
# The token is created through the GitHub web UI by scripts/gh-pat.mjs, used once,
# and then deleted from disk -- it is never printed and never passed on a command line.
param(
  [string]$RepoName = 'xhs-search',
  [switch]$Private,
  [int]$Port = 9222
)

$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$repoDir = Split-Path $scripts -Parent

Write-Output '=== 1/4  generate a token through the GitHub UI ==='
node (Join-Path $scripts 'gh-pat.mjs') token
if ($LASTEXITCODE -ne 0) { throw 'token step failed' }

Write-Output '=== 2/4  create the repository and push ==='
$pushArgs = @((Join-Path $scripts 'gh-push.mjs'), $RepoName)
if ($Private) { $pushArgs += '--private' }
node @pushArgs
if ($LASTEXITCODE -ne 0) { throw 'push step failed' }

Write-Output '=== 3/4  verify the remote matches local ==='
git -C $repoDir fetch origin main -q 2>$null
$local = git -C $repoDir rev-parse HEAD
$remote = git -C $repoDir rev-parse origin/main
if ($local -eq $remote) { Write-Output "remote is up to date: $($local.Substring(0,7))" }
else { Write-Output "WARNING: local $($local.Substring(0,7)) != remote $($remote.Substring(0,7))" }

Write-Output '=== 4/4  clean up local credentials ==='
git -C $repoDir config --local --unset credential.helper 2>$null | Out-Null
foreach ($f in @((Join-Path $scripts '_token.txt'), (Join-Path $env:USERPROFILE '.git-credentials'))) {
  if (Test-Path $f) { Remove-Item $f -Force; Write-Output "removed $f" }
}
Write-Output 'done.'
