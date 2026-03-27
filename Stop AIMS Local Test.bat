@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local.ps1"
if errorlevel 1 (
  echo.
  echo Failed to stop the local test stack cleanly.
  echo Press any key to close this window.
  pause >nul
)
