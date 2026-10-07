$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & node.exe 'scripts/acceptance-legacy-pathlab.mjs'
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "legacy .pathlab acceptance failed with exit code $exitCode" }
} finally {
  Pop-Location
}
