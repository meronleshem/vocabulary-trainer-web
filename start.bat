@echo off
start "VocabApp Backend" cmd /k "cd /d %~dp0backend && uvicorn main:app --reload"
start "VocabApp Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
