@echo off
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  call ".venv\Scripts\activate.bat"
) else (
  echo Please run start.bat once to create .venv
  pause
  exit /b 1
)
python scripts\download_sensevoice.py
pause
