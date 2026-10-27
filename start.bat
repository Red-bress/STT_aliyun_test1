@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Voice STT Offline - SenseVoice-Small

set "PY="
where python >nul 2>&1
if not errorlevel 1 set "PY=python"
if not defined PY if exist "C:\ProgramData\miniconda3\python.exe" set "PY=C:\ProgramData\miniconda3\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set "PY=%LocalAppData%\Programs\Python\Python311\python.exe"
if not defined PY (
  echo [ERROR] Python not found. Install Python 3.10+ or Miniconda.
  pause
  exit /b 1
)

if not exist "models\SenseVoiceSmall\config.yaml" (
  if not exist "models\SenseVoiceSmall\configuration.json" (
    echo [INFO] SenseVoiceSmall model missing. Downloading...
    if not exist ".venv\Scripts\python.exe" (
      echo [1/3] Creating venv...
      "%PY%" -m venv .venv
      if errorlevel 1 (
        echo [ERROR] venv failed
        pause
        exit /b 1
      )
    )
    call ".venv\Scripts\activate.bat"
    python -m pip install -U pip
    pip install -r requirements.txt
    if errorlevel 1 (
      echo [ERROR] pip install failed
      pause
      exit /b 1
    )
    python scripts\download_sensevoice.py
    if errorlevel 1 (
      echo [ERROR] model download failed
      pause
      exit /b 1
    )
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] Creating venv...
  "%PY%" -m venv .venv
  if errorlevel 1 (
    echo [ERROR] venv failed
    pause
    exit /b 1
  )
  call ".venv\Scripts\activate.bat"
  python -m pip install -U pip
  pip install -r requirements.txt
  if errorlevel 1 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
  )
) else (
  call ".venv\Scripts\activate.bat"
)

REM Default ASR timeout 90s; override before start: set ASR_TIMEOUT_SEC=120
if not defined ASR_TIMEOUT_SEC set "ASR_TIMEOUT_SEC=90"

echo [2/2] Starting http://127.0.0.1:8765  (SenseVoice-Small, timeout=%ASR_TIMEOUT_SEC%s)
set "SENSEVOICE_MODEL_DIR=%~dp0models\SenseVoiceSmall"
cd /d "%~dp0server"
python -m uvicorn main:app --host 127.0.0.1 --port 8765
echo.
echo Server exited. Press any key to close.
pause
