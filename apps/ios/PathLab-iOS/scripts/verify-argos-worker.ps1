param(
  [switch]$SkipBuild,
  [switch]$UsePython,
  [string]$Operation = 'has-model',
  [string]$SourceLanguage = 'zh',
  [string]$TargetLanguage = 'en',
  [string]$Text = '',
  [string]$ModelPath = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$root = Split-Path -Parent $PSScriptRoot
$worker = Join-Path $root 'translator\dist\pathlab-argos-worker.exe'
$sandbox = Join-Path $root '.argos-smoke'
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null

if (-not $SkipBuild) {
  Push-Location $root
  try {
    & npm.cmd run build:argos
    $buildExit = $LASTEXITCODE
    if ($buildExit -ne 0) { throw "Argos build failed with exit code $buildExit" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
  throw "Argos worker not found: $worker"
}

$env:ARGOS_PACKAGES_DIR = Join-Path $sandbox 'packages'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:ARGOS_STANZA_AVAILABLE = '0'
$env:ARGOS_CHUNK_TYPE = 'MINISBD'
$env:XDG_DATA_HOME = Join-Path $sandbox 'data'
$env:XDG_CONFIG_HOME = Join-Path $sandbox 'config'
$env:XDG_CACHE_HOME = Join-Path $sandbox 'cache'

$request = @{
  op = $Operation
  sourceLanguage = $SourceLanguage
  targetLanguage = $TargetLanguage
  text = $Text
  modelPath = $ModelPath
} | ConvertTo-Json -Compress

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
if ($UsePython) {
  $start.FileName = Join-Path $root '.argos-build-env\Scripts\python.exe'
  $start.ArgumentList.Add((Join-Path $root 'translator\worker.py'))
  $env:PATHLAB_TRANSLATION_DEBUG = '1'
} else {
  $start.FileName = $worker
}
$process = [System.Diagnostics.Process]::Start($start)
$process.StandardInput.WriteLine($request)
$process.StandardInput.Close()
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()
$workerExit = $process.ExitCode

if ($stdout) { [Console]::WriteLine($stdout.Trim()) }
if ($stderr) { [Console]::Error.WriteLine($stderr.Trim()) }
if ($workerExit -ne 0) { throw "Argos worker failed with exit code $workerExit" }
