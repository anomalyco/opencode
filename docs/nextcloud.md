# Nextcloud Mirror

Mirror de descarga para assets de release de gentle-opencode, alojado en Nextcloud.

## URLs

| Recurso | URL |
|---------|-----|
| Public share (file drop) | `https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD` |
| WebDAV endpoint | `https://enlaceschacocloud.duckdns.org/public.php/webdav` |

## Sincronizar un Release

```bash
# Sin versión: sincroniza la última release de GitHub
./scripts/sync-to-nextcloud.sh

# Con versión específica
./scripts/sync-to-nextcloud.sh v1.0.9
```

El script descarga los assets desde GitHub (`gh release download`) y los sube al WebDAV con autenticación Basic (el token del share como username, password vacío).

## Cómo lo Usa el Installer

El instalador (`install.ps1`) usa el mirror de dos formas:

1. **Forzado** (`-UseMirror`): descarga directamente desde Nextcloud sin intentar GitHub.
2. **Auto-fallback**: si la descarga desde GitHub falla, reintenta automáticamente contra el mirror.

El fallback ocurre de forma transparente — el usuario no necesita hacer nada.

## Formato de Download URL

Los assets se descargan desde el WebDAV con autenticación Basic:

```
URL:    https://enlaceschacocloud.duckdns.org/public.php/webdav/{filename}
Auth:   Basic base64("{token}:")   — token como username, password vacío
```

Ejemplo:

```powershell
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("ojAcbHDQBTX97oD:"))
Invoke-WebRequest -Uri "https://enlaceschacocloud.duckdns.org/public.php/webdav/opencode_1.0.9_windows_amd64.zip" `
  -Headers @{ "Authorization" = "Basic $auth" } `
  -OutFile "opencode_1.0.9_windows_amd64.zip"
```

## Comportamiento del Installer

| Modo | Orden de descarga |
|------|------------------|
| Normal | GitHub → Nextcloud (solo si GitHub falla) |
| `-UseMirror` | Nextcloud directamente |

La variable de entorno `NEXTCLOUD_TOKEN` puede sobreescribir el token por defecto para entornos CI/CD.
