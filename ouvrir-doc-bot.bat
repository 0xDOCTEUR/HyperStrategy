@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run build
start "" http://localhost:5173/HyperStrategy/
call npm run preview -- --host 127.0.0.1 --port 5173
