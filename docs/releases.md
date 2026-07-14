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

---

## Quick Links

- **GitHub Releases**: <https://github.com/ivanfernadezm99/opencode/releases>
- **Nextcloud mirror** (descarga pública): <https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD>
- **Sync script**: `./scripts/sync-to-nextcloud.sh`
