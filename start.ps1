$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Missing .venv. Run start.bat once after installing Python.' }
$modelDir = Join-Path $PSScriptRoot 'models\SenseVoiceSmall'
$cfg = Join-Path $modelDir 'config.yaml'
$cfg2 = Join-Path $modelDir 'configuration.json'
if (-not (Test-Path $cfg) -and -not (Test-Path $cfg2)) { throw 'Missing SenseVoiceSmall model. Run scripts\download_sensevoice.py' }
if (-not $env:ASR_TIMEOUT_SEC) { $env:ASR_TIMEOUT_SEC = '90' }
$env:SENSEVOICE_MODEL_DIR = $modelDir
Set-Location (Join-Path $PSScriptRoot 'server')
Write-Host "Starting http://127.0.0.1:8765 SenseVoice-Small (timeout=$($env:ASR_TIMEOUT_SEC)s)"
& $py -m uvicorn main:app --host 127.0.0.1 --port 8765
