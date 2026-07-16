# Releases — Gentle OpenCode

Guía completa de build, release y assets del fork. Si hacés un release nuevo, seguí estos pasos **en orden**.

---

## Build Process (desde Linux)

### 1. Buildear el CLI (opencode.exe)

```bash
cd /home/servidor/Descargas/opencode/packages/opencode

# IMPORTANTE: usar BUILD_ONLY para no compilar los 12 targets (OOM)
BUILD_ONLY=opencode-windows-x64 bun run script/build.ts --skip-install
```

Output: `packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` (~160 MB)

### 2. Buildear el desktop app (Electron NSIS)

```bash
cd /home/servidor/Descargas/opencode/packages/desktop

# Cross-compile para Windows desde Linux
export TARGET_PLATFORM=win32
export TARGET_ARCH=x64

# Instalar dependencias y buildear
bun install
bun run build   # electron-vite build -> genera el bundle
npx electron-builder --win --x64   # empaqueta en NSIS installer
```

Output: `packages/desktop/dist/opencode-desktop-win-x64.exe` (~122 MB)

> **⚠️ TARGET_PLATFORM y TARGET_ARCH son OBLIGATORIOS**. Sin ellos, electron-vite resuelve `@lydell/node-pty` para la plataforma del host (Linux) y el binario no arranca en Windows.

### 3. Buildear el instalador NSIS (opencode + gentle-ai)

```bash
cd /home/servidor/Descargas/opencode

# Requisito: nsis + nsis-common instalados
# sudo apt-get install -y nsis nsis-common

VERSION=$(node -e "console.log(require('./packages/opencode/package.json').version)")

/usr/bin/makensis -V4 \
  -DPRODUCT_VERSION="$VERSION" \
  -DGENTLE_AI_VERSION="2.1.6" \
  -DBINARY_DIR="/home/servidor/Descargas/opencode/packages/opencode/dist/opencode-windows-x64/bin" \
  -DLICENSE_FILE="/home/servidor/Descargas/opencode/LICENSE" \
  -DPRODUCT_OUTFILE="/home/servidor/Descargas/opencode/dist/opencode-setup-${VERSION}.exe" \
  /home/servidor/Descargas/opencode/scripts/installer.nsi
```

Output: `dist/opencode-setup-X.Y.Z.exe` (~56 MB comprimido)

### 4. Empaquetar el CLI como .zip (para install.ps1)

```bash
cd /home/servidor/Descargas/opencode/packages/opencode/dist/opencode-windows-x64/bin
zip /tmp/opencode_${VERSION}_windows_amd64.zip opencode.exe
```

### 5. Crear el release en GitHub

```bash
cd /home/servidor/Descargas/opencode

gh release create v${VERSION} \
  --repo ivanfernadezm99/opencode \
  --title "Gentle OpenCode v${VERSION}" \
  --notes "Release notes..." \
  install.ps1 \
  install.bat \
  uninstall.ps1 \
  /tmp/opencode_${VERSION}_windows_amd64.zip \
  dist/opencode-setup-${VERSION}.exe \
  packages/desktop/dist/opencode-desktop-win-x64.exe
```

---

## Release Assets (checklist)

Estos son TODOS los archivos que deben estar en cada release. Si falta uno, `install.ps1` falla.

| Archivo | Peso | Quién lo usa | Build step |
|---|---|---|---|
| `install.ps1` | ~27 KB | `.bat` wrapper (lo baja de `releases/latest`) | No se buildea — es el script fuente |
| `install.bat` | ~400 B | Usuario (doble-click) | No se buildea — wrapper estático |
| `uninstall.ps1` | ~6 KB | Limpieza manual | No se buildea |
| `opencode_X.Y.Z_windows_amd64.zip` | ~55 MB | `install.ps1` (flujo automático) | Step 4 |
| `opencode-setup-X.Y.Z.exe` | ~56 MB | Instalación manual NSIS | Step 3 |
| `opencode-desktop-win-x64.exe` | ~122 MB | `install.ps1 -Desktop` | Step 2 |

### Cómo funciona el flujo automático

```
Usuario ejecuta install.bat (doble-click)
  └─> Descarga install.ps1 desde releases/latest
        └─> Detecta última versión vía GitHub API
              └─> Descarga opencode_X.Y.Z_windows_amd64.zip
              └─> Descarga gentle-ai desde Gentleman-Programming/gentle-ai
              └─> (Opcional -Desktop) Descarga opencode-desktop-win-x64.exe
```

**Para que funcione**: el release `latest` DEBE tener `install.ps1`, `opencode_X.Y.Z_windows_amd64.zip`, y `opencode-desktop-win-x64.exe`.

---

## Version History

| Versión | Cambio |
|---|---|
| v1.17.11 | NSIS installer para opencode + gentle-ai, repo gentle-ai corregido (Gentleman-Programming), pre-existing type errors fixes |
| v1.0.12 | Full Windows desktop app (`-Desktop` flag), NSIS installer (`opencode-desktop-win-x64.exe`), `install.bat` wrapper, `uninstall.bat`, UTF-8 BOM fix, desktop shortcut, complete uninstaller |
| v1.0.11 | Create desktop shortcut after install |
| v1.0.10 | Auto-clean orphaned shortcuts |
| v1.0.9 | Fix: mirror Nextcloud usa WebDAV + auth, timeout 300s |
| v1.0.8 | Fix: detección de prerequisitos sin crashear |
| v1.0.7 | Fix: PS 5.1 compatibility (ASCII-only, if/elseif, splatting) |
| v1.0.6 | `-UseBasicParsing`, retry con backoff, mirror fallback |
| v1.0.5 | Auto-fallback a Nextcloud cuando GitHub no responde |
| v1.0.4 | Sin rate limit de GitHub API |
| v1.0.3 | Soporte mirror Nextcloud + script de sync |
| v1.0.2 | Auto-install de git, node, npm vía winget |
| v1.0.1 | Backup automático de engram.db |
| v1.0.0 | Release inicial |

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
