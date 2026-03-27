@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local.ps1"
if errorlevel 1 (
  echo.
  echo Failed to start the local test stack.
  echo Check the message above, then press any key to close this window.
  pause >nul
)
