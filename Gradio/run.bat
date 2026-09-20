@echo off
cd /d "%~dp0"
echo Starting Gradio app...

REM ROCm/AMD environment variables to fix VAE decode hangs
set TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1
set MIOPEN_FIND_MODE=2

REM If venv exists (AMD ROCm setup), use it; otherwise use system Python
if exist "venv\Scripts\python.exe" goto :use_venv
goto :use_system

:use_venv
echo Using venv (ROCm 7.2.1)
set "PYTHON=venv\Scripts\python.exe"
goto :preload

:use_system
echo Using system Python (CUDA)
set "PYTHON=python"

:preload
REM Pre-download all models/LoRAs before launching
echo.
echo Pre-downloading AI models and LoRAs...
"%PYTHON%" preload.py
if errorlevel 1 (
    echo ERROR: Failed to pre-download models. Check your internet connection.
    pause
    exit /b 1
)
echo.

REM Launch the Gradio app
"%PYTHON%" app.py
pause
