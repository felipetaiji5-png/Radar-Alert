@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 22.12 ou superior: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias do projeto...
  call npm install
  if errorlevel 1 goto failed
)
start "Radar Alert" http://localhost:5173
call npm run dev
if errorlevel 1 goto failed
exit /b 0
:failed
echo Ocorreu um erro. Verifique o terminal acima.
pause
