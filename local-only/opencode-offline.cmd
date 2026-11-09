@echo off
rem local-only: Startet opencode unter Windows ohne Zugriffe nach außen (Gegenstück zu offline.env).
rem Ablage: im selben Ordner wie opencode.exe und rg.exe. Konfiguration: %USERPROFILE%\.config\opencode\opencode.jsonc

rem rg.exe neben opencode.exe finden; opencode lädt ripgrep nicht herunter
set "PATH=%~dp0;%PATH%"

rem Modellkatalog aus dem gebündelten Snapshot statt https://models.opencode.ai
set OPENCODE_DISABLE_MODELS_FETCH=1
rem Kein Update-Check / Auto-Update
set OPENCODE_DISABLE_AUTOUPDATE=1
rem Kostenlose opencode-Zen-Modelle (Cloud) ausblenden
set OPENCODE_DISABLE_FREE_MODELS=1

rem API-Key für den Provider "firma" (auskommentiert lassen, wenn der Server keinen verlangt)
rem set FIRMA_API_KEY=...

"%~dp0opencode.exe" %*
