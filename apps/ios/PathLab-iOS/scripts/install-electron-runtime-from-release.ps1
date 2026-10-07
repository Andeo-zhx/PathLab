$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$electronRoot = Join-Path $root 'node_modules\electron'
$destination = Join-Path $electronRoot 'dist'
$electronExe = Join-Path $destination 'electron.exe'
$archiveName = 'electron-v44.4.5-win32-x64.zip'
$archiveUrl = "https://github.com/electron/electron/releases/download/v44.4.5/$archiveName"
$downloadRoot = Join-Path $root 'verification\electron-runtime-download'
$archivePath = Join-Path $downloadRoot $archiveName

$resolvedRoot = [System.IO.Path]::GetFullPath($electronRoot)
$resolvedDestination = [System.IO.Path]::GetFullPath($destination)
if (-not $resolvedDestination.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Electron extraction target escaped the package directory: $resolvedDestination"
}
if (Test-Path -LiteralPath $electronExe -PathType Leaf) {
  Get-Item -LiteralPath $electronExe | Select-Object FullName, Length
  return
}

$checksums = Get-Content -LiteralPath (Join-Path $electronRoot 'checksums.json') -Raw | ConvertFrom-Json -AsHashtable
$expectedHash = [string]$checksums[$archiveName]
if ($expectedHash -notmatch '^[0-9a-fA-F]{64}$') { throw "Official SHA-256 not found for $archiveName" }
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
Write-Output "Downloading official Electron 44.4.5 Windows x64 runtime (SHA-256: $expectedHash)."
& curl.exe --silent --show-error --fail --location --retry 3 --retry-all-errors --output $archivePath $archiveUrl
$curlExit = $LASTEXITCODE
if ($curlExit -ne 0) { throw "Electron release download failed with curl exit code $curlExit" }

$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash.ToUpperInvariant()) { throw "Electron archive SHA-256 mismatch: $actualHash" }
if (Test-Path -LiteralPath $destination) { throw "Extraction target already exists but has no electron.exe: $destination" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $destination)
if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw "Electron extraction completed without electron.exe: $electronExe" }
Remove-Item -LiteralPath $archivePath -Force
Get-Item -LiteralPath $electronExe | Select-Object FullName, Length
