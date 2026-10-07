$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$expected = [System.IO.Path]::GetFullPath((Join-Path $root '.argos-smoke'))
$target = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path '.argos-smoke'))
if ($target -ne $expected) { throw "Refusing to clean a path other than the exact verification cache: $target" }
if (Test-Path -LiteralPath $target -PathType Container) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
if (Test-Path -LiteralPath $target) { throw "Verification cache still exists after cleanup: $target" }
Write-Output "Removed isolated test cache: $target"
