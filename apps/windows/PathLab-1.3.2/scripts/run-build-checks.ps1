$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  foreach ($scriptName in @('build', 'lint')) {
    Write-Output "Running npm run $scriptName"
    & npm.cmd run $scriptName
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "npm run $scriptName failed with exit code $exitCode" }
  }
} finally {
  Pop-Location
}
