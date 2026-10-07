$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$portable = Join-Path $root 'release\PathLab-Desktop-1.3.2-win-x64.exe'
$port = 9237
if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) { throw "Portable executable not found: $portable" }
$occupied = netstat.exe -ano -p tcp | Select-String -Pattern ':9237\s+.*LISTENING'
if ($occupied) { throw "Remote-debugging port $port is already in use: $occupied" }

$app = $null
try {
  $app = Start-Process -FilePath $portable -ArgumentList @('--remote-debugging-port=9237') -WorkingDirectory (Split-Path -Parent $portable) -WindowStyle Hidden -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    $listener = netstat.exe -ano -p tcp | Select-String -Pattern ':9237\s+.*LISTENING' | Select-Object -First 1
    if ($listener) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Packaged PathLab did not open the local smoke-test port.' }

  Push-Location $root
  try {
    & node.exe 'scripts/portable-smoke-132.mjs'
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Portable smoke test failed with exit code $exitCode" }
  } finally {
    Pop-Location
  }
} finally {
  $listener = netstat.exe -ano -p tcp | Select-String -Pattern ':9237\s+.*LISTENING' | Select-Object -First 1
  if ($listener) {
    $ownerId = [int](($listener.Line -split '\s+')[-1])
    Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
  }
  if ($app) {
    $app.Refresh()
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  }
}
