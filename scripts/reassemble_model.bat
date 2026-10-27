@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if not exist "models\parts" (
  echo 未找到 models\parts
  exit /b 1
)
mkdir "models\faster-whisper-large-v3" 2>nul
echo 合并 model.bin ...
copy /b models\parts\model.bin.part* "models\faster-whisper-large-v3\model.bin"
if exist "models\parts\sidecar\*" copy /y "models\parts\sidecar\*" "models\faster-whisper-large-v3\"
dir "models\faster-whisper-large-v3"
