@echo off
echo ========================================
echo   SysControl v2 — Install (Dev Mode)
echo ========================================
echo.

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
echo Installing dependencies...
pip install -r requirements.txt -q

echo.
echo Starting server...
echo Open http://localhost:5000 to complete setup.
echo.
python server.py
