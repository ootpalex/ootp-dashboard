@echo off
REM Windows double-click launcher for the OOTP Dashboard.
REM Uses the Python launcher (`py`) which is installed by the standard
REM Python installer with the "Add Python to PATH" option.
cd /d "%~dp0"
py run.py %*
pause
