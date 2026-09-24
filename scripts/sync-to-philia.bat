@echo off
set "SRC=C:\Users\Luiz Alfonso Lee\Whatever bro\ai shit idk"
set "DST=C:\Users\Luiz Alfonso Lee\Whatever bro\Philia"

echo ====================================================
echo  Syncing Philia Project to New Folder:
echo  %DST%
echo ====================================================

robocopy "%SRC%" "%DST%" /MIR /XD ".kilo" /R:1 /W:1 /NP /NFL /NDL

if %ERRORLEVEL% LSS 8 (
    echo [SUCCESS] Project successfully synced to %DST%!
    exit /b 0
) else (
    echo [ERROR] Robocopy encountered an error. Code: %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
