# Releases — Gentle OpenCode

Documentación del proceso de release, assets incluidos e historial de versiones del fork.

---

## Release Flow

```bash
# 1. Taggear y pushear
git tag -a vX.Y.Z -m "vX.Y.Z: descripción"
git push fork vX.Y.Z --force --no-verify

# 2. Crear release en GitHub con assets
gh release create vX.Y.Z \
  --repo ivanfernadezm99/opencode \
  --title "Gentle OpenCode vX.Y.Z" \
  --notes "..." \
  install.ps1 install.bat opencode_X.Y.Z_windows_amd64.zip

# 3. Sincronizar a Nextcloud
./scripts/sync-to-nextcloud.sh vX.Y.Z
```

---

## Release Assets

| Archivo | Peso | Descripción |
|---|---|---|
| `install.ps1` | ~17 KB | Instalador PowerShell (detecta prerequisitos, usa winget si faltan) |
| `install.bat` | 398 B | Wrapper para doble-click (invoca `install.ps1` con `-ExecutionPolicy Bypass`) |
| `opencode_X.Y.Z_windows_amd64.zip` | ~55 MB | Binario CLI compilado para Windows x64 |
| `uninstall.ps1` | ~6 KB | Desinstalador: limpia binarios, config, PATH, accesos directos. Backup automático de Engram antes de borrar. |
| `opencode-desktop-win-x64.exe` | ~122 MB | NSIS desktop app installer |

---

## Version History

| Versión | Cambio |
|---|---|
| v1.0.0 | Release inicial: installer NSIS + CLI binario |
| v1.0.1 | Backup automático de engram.db antes de reinstalar |
| v1.0.2 | Auto-install de git, node, npm vía winget en Windows frescas |
| v1.0.3 | Soporte mirror Nextcloud + script de sync (`-UseMirror`) |
| v1.0.4 | Sin rate limit de GitHub API (usa HTTP redirect en vez de api.github.com) |
| v1.0.5 | Auto-fallback a Nextcloud cuando GitHub no responde |
| v1.0.6 | `-UseBasicParsing` en todos lados, retry con backoff, mirror fallback en descargas |
| v1.0.7 | Fix: reemplazo de switch por if/elseif + splatting + caracteres ASCII-only para PS 5.1 |
| v1.0.8 | Fix: detección de prerequisitos sin crashear (usa Get-Command, no ejecuta binarios) |
| v1.0.9 | Fix: mirror Nextcloud usa WebDAV + auth, timeout de descarga 300s. Probado en Windows real |
| v1.0.10 | Auto-clean orphaned shortcuts: remove broken `OpenCode*.lnk` from Desktop, Start Menu, and Taskbar on install |
| v1.0.11 | Create desktop shortcut after install |
| v1.0.12 | Full Windows desktop app (`-Desktop` flag), NSIS installer (`opencode-desktop-win-x64.exe`), `install.bat` wrapper that downloads `install.ps1` on demand, `uninstall.bat` wrapper that downloads `uninstall.ps1`, UTF-8 BOM fix for PS 5.1, desktop shortcut creation after install, complete uninstaller for binaries/config/PATH/shortcuts |

---

## Quick Links

- **GitHub Releases**: <https://github.com/ivanfernadezm99/opencode/releases>
- **Nextcloud mirror**: <https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD>
- **Sync script**: `./scripts/sync-to-nextcloud.sh`

---

## Uninstaller

El `uninstall.ps1` deja la máquina completamente limpia:

| Componente | Acción |
|---|---|
| `%LOCALAPPDATA%\opencode\` | Borrado |
| `%LOCALAPPDATA%\gentle-ai\` | Borrado |
| `~\.config\opencode\` | Borrado |
| `%APPDATA%\ai.opencode.desktop.dev\` | Borrado |
| Accesos directos | Borrados |
| PATH entries | Limpiados |
| `~\.engram\engram.db` | **Backup automático** antes de borrar (solo con `-RemoveEngram`) |

```powershell
# Instalar
irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex

# Desinstalar (preserva Engram)
irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/uninstall.ps1 | iex

# Desinstalar TODO incluido Engram (con backup)
.\uninstall.ps1 -RemoveEngram
```
