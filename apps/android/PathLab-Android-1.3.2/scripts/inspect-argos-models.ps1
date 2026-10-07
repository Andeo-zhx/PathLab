$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$indexUrl = 'https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json'
$packages = Invoke-RestMethod -Uri $indexUrl -TimeoutSec 45
$packages |
  Where-Object { $_.from_code -in @('zh', 'en') -and $_.to_code -in @('zh', 'en') -and $_.from_code -ne $_.to_code } |
  Select-Object from_code, to_code, package_version, argos_version, links |
  ConvertTo-Json -Depth 6
