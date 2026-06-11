@echo off
title EDBO SHAP Lab - 停止服务
chcp 65001 >nul

echo ========================================
echo   正在停止 EDBO SHAP Lab 服务...
echo ========================================
echo.

:: 关闭后端 (Python main.py)
echo 正在停止后端服务...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq python.exe" /nh 2^>nul') do (
  taskkill /pid %%i /f >nul 2>nul
)

:: 关闭前端 (Node.js / Vite)
echo 正在停止前端服务...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /nh 2^>nul') do (
  taskkill /pid %%i /f >nul 2>nul
)

echo.
echo 所有服务已停止
echo.
pause
