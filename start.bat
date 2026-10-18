@echo off
setlocal
pushd "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js 18 or newer is required. Install Node.js, then run this file again.
    pause
    popd
    exit /b 1
)

if not exist "node_modules\mdict-js" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo npm was not found. Reinstall Node.js with npm included.
        pause
        popd
        exit /b 1
    )
    echo Installing project dependencies...
    call npm install
    if errorlevel 1 (
        echo Dependency installation failed.
        pause
        popd
        exit /b 1
    )
)

curl.exe --silent --fail "http://127.0.0.1:4173/api/dictionaries" --output nul >nul 2>&1
if errorlevel 1 (
    echo Starting Kotobacho...
    start "Kotobacho Local Server" /min node "%~dp0server.js"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $response=Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/dictionaries' -TimeoutSec 2; if ($null -ne $response.dictionaries) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
    echo Kotobacho did not start. Check whether port 4173 is already in use.
    pause
    popd
    exit /b 1
)

start "" "http://127.0.0.1:4173"
popd
exit /b 0
