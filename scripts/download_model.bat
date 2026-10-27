@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 下载 Systran/faster-whisper-large-v3 到 models\ ...
echo 体积约 2.9 GB，需联网一次；下完后可离线使用。
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  call .venv\Scripts\activate.bat
  pip install -U pip huggingface-hub
) else (
  call .venv\Scripts\activate.bat
  pip install -q huggingface-hub
)
REM 国内可设镜像: set HF_ENDPOINT=https://hf-mirror.com
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-large-v3', local_dir='models/faster-whisper-large-v3')"
if exist "models\faster-whisper-large-v3\model.bin" (
  echo 模型就绪。
  exit /b 0
) else (
  echo 下载失败。
  exit /b 1
)
