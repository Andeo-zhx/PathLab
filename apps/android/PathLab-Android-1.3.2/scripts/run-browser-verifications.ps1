$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  foreach ($scriptName in @('verify', 'verify:ui')) {
    Write-Output "Running npm run $scriptName"
    & npm.cmd run $scriptName
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "npm run $scriptName failed with exit code $exitCode" }
  }

  Write-Output 'Running translation dialog acceptance'
  & node.exe 'scripts/acceptance-translation.mjs'
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "translation acceptance failed with exit code $exitCode" }
} finally {
  Pop-Location
}
