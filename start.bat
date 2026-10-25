@echo off
chcp 65001 >nul
title Minecraft Buddy
cd /d "%~dp0"
if not exist node_modules (
  echo Первый запуск: устанавливаю библиотеки...
  call npm install
  if errorlevel 1 (
    echo Не удалось установить библиотеки. Проверь подключение к интернету и Node.js.
    pause
    exit /b 1
  )
)
echo.
echo Minecraft Buddy запускается.
echo Команды вводятся в это окно. Для выхода нажми Ctrl+C.
echo.
call npm start
echo.
pause
