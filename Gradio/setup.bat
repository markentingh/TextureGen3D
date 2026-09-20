@echo off
setlocal enabledelayedexpansion
echo ============================================
echo  TextureGen3D Gradio - Setup
echo ============================================
echo.

set /p GPU_TYPE="Do you have an NVIDIA or AMD GPU? (nvidia/amd): "

if /i "%GPU_TYPE%"=="nvidia" goto :nvidia
if /i "%GPU_TYPE%"=="amd" goto :amd
echo Invalid choice. Please type 'nvidia' or 'amd'.
pause
exit /b 1

:nvidia
echo.
REM Check if PyTorch is already installed
python -c "import torch" >nul 2>&1
if %errorlevel%==0 (
    echo PyTorch is already installed. Skipping PyTorch installation.
) else (
    echo Installing PyTorch with CUDA support (NVIDIA)...
    pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
    if errorlevel 1 (
        echo ERROR: Failed to install PyTorch with CUDA support.
        pause
        exit /b 1
    )
)
echo.
REM Check if all key dependencies are already installed
python -c "import gradio, diffusers, transformers, accelerate, peft, einops, omegaconf" >nul 2>&1
if %errorlevel%==0 (
    echo Dependencies already installed. Skipping.
) else (
    echo Installing other dependencies...
    pip install gradio diffusers transformers accelerate safetensors sentencepiece protobuf peft ninja pybind11 einops opencv-python omegaconf huggingface_hub
)
echo.
echo ============================================
echo  NVIDIA setup complete! Run run.bat to start.
echo ============================================
pause
exit /b 0

:amd
echo.
echo AMD GPU detected. Using native ROCm 7.2.1 wheels (no ZLUDA needed).
echo.

REM Check if venv already exists with torch installed
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe -c "import torch; assert torch.version.hip is not None" >nul 2>&1
    if !errorlevel!==0 (
        echo Virtual environment already exists with ROCm PyTorch installed.
        echo Skipping ROCm SDK and PyTorch installation.
        goto :amd_deps
    ) else (
        echo Virtual environment exists but ROCm PyTorch is missing. Reinstalling...
    )
) else (
    echo Checking for Python 3.12...

    REM Check if Python 3.12 is available
    py -3.12 --version >nul 2>&1
    if %errorlevel%==0 (
        echo Python 3.12 found.
        set "PY312=py -3.12"
    ) else (
        echo Python 3.12 not found. Installing via winget...
        winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            echo ERROR: Failed to install Python 3.12.
            echo Please install Python 3.12 from https://www.python.org/downloads/
            pause
            exit /b 1
        )
        set "PY312=py -3.12"
    )

    echo.
    echo Creating virtual environment with Python 3.12...
    %PY312% -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )

    echo.
    echo Upgrading pip in venv...
    venv\Scripts\python.exe -m pip install --upgrade pip
)

REM Only install ROCm SDK and PyTorch if torch isn't already available with ROCm
venv\Scripts\python.exe -c "import torch; assert torch.version.hip is not None" >nul 2>&1
if %errorlevel%==0 (
    echo ROCm PyTorch already installed. Skipping ROCm SDK installation.
) else (
    echo.
    echo Installing ROCm SDK core libraries...
    venv\Scripts\pip install --no-cache-dir ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm-7.2.1.tar.gz

    if errorlevel 1 (
        echo ERROR: Failed to install ROCm SDK libraries.
        pause
        exit /b 1
    )

    echo.
    echo Installing PyTorch with ROCm 7.2.1 support...
    venv\Scripts\pip install --no-cache-dir ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torch-2.9.1%%2Brocm7.2.1-cp312-cp312-win_amd64.whl ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torchaudio-2.9.1%%2Brocm7.2.1-cp312-cp312-win_amd64.whl ^
        https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torchvision-0.24.1%%2Brocm7.2.1-cp312-cp312-win_amd64.whl

    if errorlevel 1 (
        echo ERROR: Failed to install PyTorch ROCm wheels.
        pause
        exit /b 1
    )
)

:amd_deps
echo.
REM Check if all key dependencies are already installed in the venv
venv\Scripts\python.exe -c "import gradio, diffusers, transformers, accelerate, peft, einops, omegaconf" >nul 2>&1
if %errorlevel%==0 (
    echo Dependencies already installed. Skipping.
) else (
    echo Installing other dependencies...
    venv\Scripts\pip install gradio diffusers transformers accelerate safetensors sentencepiece protobuf peft ninja pybind11 einops opencv-python omegaconf huggingface_hub
)

echo.
echo Cleaning up old ZLUDA files...
if exist ".zluda" rmdir /s /q .zluda

echo.
echo ============================================
echo  AMD setup complete!
echo.
echo  Requirements:
echo   - AMD HIP SDK 7.1 or 7.2 must be installed
echo     Download from: https://www.amd.com/en/developer/resources/rocm-hub/hip-sdk.html
echo   - AMD Adrenalin driver 26.2.2 or newer
echo   - Python 3.12 (installed in venv\)
echo
echo  Run run.bat to start the app.
echo ============================================
pause
exit /b 0
