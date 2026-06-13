@echo off
title GESTPAL — Démarrage
cd /d "%~dp0"

echo Démarrage du serveur GESTPAL...
start "GESTPAL Serveur" /min cmd /k "node src/server.js"

echo Démarrage du pont bascule...
start "GESTPAL Bascule" /min cmd /k "node scale-bridge/bridge.js"

echo.
echo GESTPAL est démarré.
echo   Serveur  : http://localhost:3000
echo   Pour arrêter : fermer les fenêtres GESTPAL Serveur et GESTPAL Bascule
echo.
pause
