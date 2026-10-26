@echo off
cd /d "%~dp0"
node scripts\serve.mjs --with-api --open
if errorlevel 1 pause
