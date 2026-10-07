$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electronDist = Join-Path $root 'node_modules\electron\dist'
$electronExe = Join-Path $electronDist 'electron.exe'
if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) {
  Push-Location $root
  try {
    & node.exe 'node_modules/electron/install.js'
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Electron runtime download failed with exit code $exitCode" }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw "Electron runtime is still missing: $electronExe" }
Get-Item -LiteralPath $electronExe | Select-Object FullName,Length
