@echo off
title EDBO SHAP Lab - 一键启动
chcp 65001 >nul

echo ========================================
echo   EDBO SHAP Lab - 一键启动
echo   实验设计贝叶斯优化平台
echo ========================================
echo.

:: 启动后端 (新窗口)
echo [1/2] 启动后端 API 服务...
start "EDBO Backend" cmd /k "cd /d %~dp0backend && python main.py"

:: 等后端启动
timeout /t 3 /nobreak >nul

:: 启动前端 (新窗口)
echo [2/2] 启动前端开发服务器...
start "EDBO Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo 后端 -> http://localhost:8000
echo 前端 -> http://localhost:3000
echo.
echo 提示: 关闭窗口即可停止服务
echo.
pause
