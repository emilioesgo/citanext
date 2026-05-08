@echo off
chcp 65001 >nul
title Actualizar Citanext en GitHub

echo ================================================
echo        ACTUALIZAR CITANEXT EN GITHUB
echo ================================================
echo.
cd /d "%~dp0"

:: Verificar que estamos en la carpeta correcta
if not exist ".git" (
    echo [ERROR] No se encontro el repositorio Git.
    echo Asegurate de estar en la carpeta del proyecto.
    pause
    exit /b
)

:: Solicitar mensaje del commit
set "commit_msg="
set /p commit_msg="Escribe el mensaje del commit (o presiona Enter para usar uno automatico): "

if "%commit_msg%"=="" (
    set "commit_msg=Actualizacion %date% %time%"
)

echo.
echo [1/3] Agregando archivos modificados...
git add .

echo [2/3] Creando commit...
git commit -m "%commit_msg%"

echo [3/3] Subiendo a GitHub...
git push origin main

echo.
echo ================================================
echo        ACTUALIZACION COMPLETADA
echo ================================================
echo.
echo Repositorio: https://github.com/emilioesgo/citanext
echo Sitio web: https://emilioesgo.github.io/citanext
echo.
pause