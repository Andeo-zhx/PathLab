$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$root = Split-Path -Parent $PSScriptRoot
$sandbox = Join-Path $root '.argos-smoke'
$worker = Join-Path $root 'translator\dist\pathlab-argos-worker.exe'
$downloads = Join-Path $sandbox 'downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) { throw '先运行 verify-argos-worker.ps1 构建 worker。' }

$env:ARGOS_PACKAGES_DIR = Join-Path $sandbox 'packages'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:ARGOS_STANZA_AVAILABLE = '0'
$env:ARGOS_CHUNK_TYPE = 'MINISBD'
$env:XDG_DATA_HOME = Join-Path $sandbox 'data'
$env:XDG_CONFIG_HOME = Join-Path $sandbox 'config'
$env:XDG_CACHE_HOME = Join-Path $sandbox 'cache'

function Invoke-Worker([hashtable]$Payload) {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $worker
  $start.WorkingDirectory = $root
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.StandardInputEncoding = $utf8
  $start.StandardOutputEncoding = $utf8
  $start.StandardErrorEncoding = $utf8
  $process = [System.Diagnostics.Process]::Start($start)
  $process.StandardInput.WriteLine(($Payload | ConvertTo-Json -Compress))
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  if ($exitCode -ne 0) { throw "worker exit=$exitCode; $stdout $stderr" }
  $response = $stdout.Trim() | ConvertFrom-Json
  if (-not $response.ok) { throw "worker error: $($response.error)" }
  return $response
}

$indexUrl = 'https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json'
$packages = Invoke-RestMethod -Uri $indexUrl -TimeoutSec 45
$directions = @(
  @{ from = 'zh'; to = 'en'; sample = "病理标注：`n肝细胞核呈深染，血窦轻度扩张。" },
  @{ from = 'en'; to = 'zh'; sample = "Pathology note:`nThe hepatocytes show mild vacuolar degeneration." }
)
$client = [System.Net.Http.HttpClient]::new()
try {
  foreach ($direction in $directions) {
    $available = $packages | Where-Object {
      $_.from_code -eq $direction.from -and $_.to_code -eq $direction.to
    } | Select-Object -First 1
    if (-not $available) { throw "官方目录缺少 $($direction.from) -> $($direction.to) 模型。" }
    $status = Invoke-Worker @{ op = 'has-model'; sourceLanguage = $direction.from; targetLanguage = $direction.to }
    if (-not $status.installed) {
      $modelUrl = [string]@($available.links)[0]
      $modelPath = Join-Path $downloads ([System.IO.Path]::GetFileName(([uri]$modelUrl).AbsolutePath))
      if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
        Write-Output "下载 $($direction.from)->$($direction.to) Argos 模型：$modelUrl"
        $response = $client.GetAsync($modelUrl, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode() | Out-Null
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [System.IO.File]::Open($modelPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose(); $response.Dispose() }
      }
      $installed = Invoke-Worker @{ op = 'install-model'; sourceLanguage = $direction.from; targetLanguage = $direction.to; modelPath = $modelPath }
      Remove-Item -LiteralPath $modelPath -Force
      $status = Invoke-Worker @{ op = 'has-model'; sourceLanguage = $direction.from; targetLanguage = $direction.to }
      if (-not $status.installed) { throw "安装后没有发现 $($direction.from) -> $($direction.to) 模型。" }
    } else {
      $installed = @{ installed = $true }
      Write-Output "$($direction.from)->$($direction.to) 模型已安装，直接验证离线翻译。"
    }
    $translation = Invoke-Worker @{ op = 'translate'; sourceLanguage = $direction.from; targetLanguage = $direction.to; text = $direction.sample }
    if ([string]::IsNullOrWhiteSpace($translation.text)) { throw "$($direction.from) -> $($direction.to) 返回空译文。" }
    if (($translation.text.ToCharArray() | Where-Object { $_ -eq "`n" }).Count -ne 1) {
      throw "$($direction.from) -> $($direction.to) 没有保留输入换行。"
    }
    [pscustomobject]@{
      direction = "$($direction.from)->$($direction.to)"
      installed = $installed.installed
      translated = $translation.text
      offline = $true
      preservedLineBreak = $true
    } | ConvertTo-Json -Compress
  }
} finally {
  $client.Dispose()
}
