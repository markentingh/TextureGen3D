@echo off
setlocal

echo =====================================================
echo  Datasilk Framework Solution Customizer
echo =====================================================
echo.

set /p PREFIX="Enter the project prefix (e.g. MyCompany): "

if "%PREFIX%"=="" (
    echo Project prefix is required.
    exit /b 1
)

echo.
set /p DBNAME="Database name (default: %PREFIX%): "
if "%DBNAME%"=="" set DBNAME=%PREFIX%
for /f "usebackq delims=" %%a in (`powershell -Command "'%DBNAME%'.ToLower()"`) do set "DBNAME=%%a"

echo.
set /p PGUSER="PostgreSQL username (default: postgres): "
if "%PGUSER%"=="" set PGUSER=postgres

for /f "delims=" %%a in ('powershell -Command "$p=Read-Host -AsSecureString 'PostgreSQL password (default: password)'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))"') do set "PGPASSWORD=%%a"
if "%PGPASSWORD%"=="" set PGPASSWORD=password

echo.
set /p APIHTTPPORT="API HTTP port (default: 7790): "
if "%APIHTTPPORT%"=="" set APIHTTPPORT=7790

set /p APIHTTPSPORT="API HTTPS port (default: 7791): "
if "%APIHTTPSPORT%"=="" set APIHTTPSPORT=7791

set /p REACTPORT="React app port (default: 7792): "
if "%REACTPORT%"=="" set REACTPORT=7792

echo.
set /p USEHTTP="Use HTTP by default for Vite? (Y/N, default: N): "
if "%USEHTTP%"=="" set USEHTTP=N

echo.
set /p FROMEMAIL="Default from email address (default: noreply@datasilk.com): "
if "%FROMEMAIL%"=="" set FROMEMAIL=noreply@datasilk.com

set /p FROMNAME="Default from name (default: Datasilk): "
if "%FROMNAME%"=="" set FROMNAME=Datasilk

set /a APIHTTPPORT_TEST=%APIHTTPPORT% 2>nul
if "%APIHTTPPORT_TEST%" NEQ "%APIHTTPPORT%" (
    echo Invalid API HTTP port: %APIHTTPPORT%
    exit /b 1
)

set /a APIHTTPSPORT_TEST=%APIHTTPSPORT% 2>nul
if "%APIHTTPSPORT_TEST%" NEQ "%APIHTTPSPORT%" (
    echo Invalid API HTTPS port: %APIHTTPSPORT%
    exit /b 1
)

set /a REACTPORT_TEST=%REACTPORT% 2>nul
if "%REACTPORT_TEST%" NEQ "%REACTPORT%" (
    echo Invalid React app port: %REACTPORT%
    exit /b 1
)

echo.
echo Customizing current solution with prefix %PREFIX%...

call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to install root tooling dependencies.
    exit /b %ERRORLEVEL%
)

echo.
echo Generating SQL deployment script...

set "SQL_DIR=%~dp0Datasilk.SQL"
if not exist "%SQL_DIR%" set "SQL_DIR=%~dp0%PREFIX%.SQL"

pushd "%SQL_DIR%"
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to install SQL tooling dependencies.
    popd
    exit /b %ERRORLEVEL%
)

call npx gulp --database "%DBNAME%"
if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to generate deploy.sql.
    popd
    exit /b %ERRORLEVEL%
)

echo.
echo Creating database and deploying schema...

set "PGPASSWORD=%PGPASSWORD%"

psql -h localhost -U %PGUSER% -d template1 -f deploy.sql
if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to create database or deploy schema.
    popd
    exit /b %ERRORLEVEL%
)

popd

call npx gulp setup --prefix "%PREFIX%" --database "%DBNAME%" --pguser "%PGUSER%" --pgpassword "%PGPASSWORD%" --api-http-port "%APIHTTPPORT%" --api-https-port "%APIHTTPSPORT%" --react-port "%REACTPORT%" --use-http "%USEHTTP%" --default-from-email "%FROMEMAIL%" --default-from-name "%FROMNAME%"

if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to customize solution. Make sure Node.js and gulp are installed.
    exit /b %ERRORLEVEL%
)

echo.
echo Installing web client dependencies...

set "CLIENT_DIR=%~dp0%PREFIX%.Web.Client"
if not exist "%CLIENT_DIR%" set "CLIENT_DIR=%~dp0Datasilk.Web.Client"

pushd "%CLIENT_DIR%"
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo Failed to install web client dependencies.
    popd
    exit /b %ERRORLEVEL%
)
popd

echo.
echo Solution customized successfully.

set "SLN_FILE=%~dp0%PREFIX%.sln"
if not exist "%SLN_FILE%" set "SLN_FILE=%~dp0Datasilk.sln"

if exist "%SLN_FILE%" (
    start "" "%SLN_FILE%"
)

pause
