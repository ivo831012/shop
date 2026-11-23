@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Няма инсталиран Node.js. Изтеглете версия 22 или по-нова от https://nodejs.org и пуснете този файл отново.
  pause
  exit /b 1
)
echo Инсталиране на нужните пакети...
call npm install || goto :err
echo Подготовка на интерфейса...
call npm run build || goto :err
call npm run seed
echo.
echo Готово. Отворете в браузъра: http://localhost:3000
echo За да спрете приложението, затворете този прозорец.
start "" http://localhost:3000
call npm start
goto :eof
:err
echo Нещо се обърка. Изпратете ми текста над този ред.
pause
