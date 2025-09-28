@echo off
REM publish-all.bat - Script de publication pour hive-p2p

echo Starting hive-p2p publication process...

REM 1. Build browser-min first
echo Building browser-min...
cd packages\browser-min
call npm run build
cd ..\..

REM 2. Bump version and publish main package (root)
echo Publishing hive-p2p (main package)...
call npm version patch
call npm publish

REM 3. Get new version from main package
for /f "tokens=2 delims=:, " %%a in ('type package.json ^| findstr "version"') do set NEW_VERSION=%%a
set NEW_VERSION=%NEW_VERSION:"=%

REM 4. Update and publish server package
echo Publishing @hive-p2p/server...
cd packages\server
call npm version %NEW_VERSION% --allow-same-version
call npm publish
cd ..\..

REM 5. Update and publish browser package  
echo Publishing @hive-p2p/browser...
cd packages\browser
call npm version %NEW_VERSION% --allow-same-version
call npm publish
cd ..\..

echo Publication complete! Version %NEW_VERSION% published
echo Browser-min build ready in packages\browser-min\hive-p2p.min.js

pause