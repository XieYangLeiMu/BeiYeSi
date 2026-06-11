@echo off
setlocal enabledelayedexpansion
title EDBO_SHAP_Lab
cd /d "%~dp0"

:: 安全网：窗口永不闪退
if not defined _SAFETY (
    set _SAFETY=1
    cmd /c ""%~f0" %*"
    pause
    exit /b
)

echo ============================================
echo    EDBO_SHAP_Lab - Bayesian Optimization
echo ============================================
echo.

:: ================================================
::  第1步：确保 uv.exe 就位（独立工具，不需要装 Python）
:: ================================================
set "UV_EXE=%CD%\tools\uv.exe"

if exist "%UV_EXE%" goto :have_uv

echo [1/4] Downloading uv (Python version manager, ~40 MB, one-time)...
if not exist "tools" mkdir tools

:: 下载 uv 压缩包
powershell -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' " ^
    "-OutFile '%CD%\tools\uv.zip'" -ErrorAction Stop
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to download uv.
    echo.
    echo   Please manually download uv.exe from:
    echo   https://github.com/astral-sh/uv/releases
    echo   (choose uv-x86_64-pc-windows-msvc.zip^)
    echo.
    echo   Extract uv.exe to: %CD%\tools\
    echo   Then double-click run.bat again.
    pause
    exit /b 1
)

:: 解压
powershell -Command ^
    "Expand-Archive -Path '%CD%\tools\uv.zip' -DestinationPath '%CD%\tools' -Force"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to extract uv.
    pause
    exit /b 1
)

:: uv.exe 在压缩包的子目录里，找出来
for /r "%CD%\tools" %%f in (uv.exe) do (
    if not "%%f"=="%UV_EXE%" (
        move /y "%%f" "%UV_EXE%" >nul 2>&1
    )
)

if not exist "%UV_EXE%" (
    echo [ERROR] uv.exe not found after extraction.
    pause
    exit /b 1
)
echo [OK] uv ready

:have_uv

:: ================================================
::  第2步：建虚拟环境（uv 自动下载 Python 3.11）
:: ================================================
if exist "backend\.venv\Scripts\python.exe" (
    for /f "tokens=2" %%v in ('backend\.venv\Scripts\python.exe --version 2^>^&1') do set "VV=%%v"
    if defined VV (
        echo   Existing venv Python: !VV!
        echo !VV! | findstr /r "^3[.]1[0-2]" >nul
        if !ERRORLEVEL! equ 0 (
            echo [2/4] Virtual environment OK, skip creation
            goto :install_deps
        )
    )
    echo [WARN] Incompatible venv Python (!VV!^), recreating...
    rmdir /s /q "backend\.venv"
)

echo [2/4] Creating virtual environment (Python 3.11)...
"%UV_EXE%" venv --python 3.11 backend\.venv
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)
echo [OK] Virtual environment created

:install_deps
:: ================================================
::  第3步：装依赖
:: ================================================
echo [3/4] Installing dependencies...
"%UV_EXE%" pip install -r backend\requirements.txt --python backend\.venv\Scripts\python.exe
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
)

:: ================================================
::  第4步：检查前端、启动服务
:: ================================================
if not exist "backend\static\index.html" (
    echo [INFO] No frontend build found, Web UI unavailable.
    echo.
)

echo [4/4] Starting server...
echo.
echo ============================================
echo   http://localhost:8001
echo ============================================
echo.

timeout /t 2 /nobreak >nul
start http://localhost:8001

backend\.venv\Scripts\python.exe backend\main.py
