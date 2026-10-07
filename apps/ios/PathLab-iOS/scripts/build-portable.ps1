$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:ELECTRON_BUILDER_CACHE = Join-Path $root '.electron-builder-cache'
Push-Location $root
try {
  & npm.cmd run package:portable
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "Portable package build failed with exit code $exitCode" }
} finally {
  Pop-Location
}
