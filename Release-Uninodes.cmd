@echo off
setlocal
set "BUMP=%~1"
if "%BUMP%"=="" set "BUMP=patch"
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Release-Uninodes.ps1" -Bump "%BUMP%"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Release did not complete. Read the error above.
pause
exit /b %RESULT%
