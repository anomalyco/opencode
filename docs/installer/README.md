# Windows Installer — install.ps1

Herramientas de instalación de OpenCode para Windows.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `install.ps1` | Instalador principal PowerShell |
| `install.bat` | Entry point batch — llama `install.ps1 -Desktop %*` |
| `uninstall.ps1` | Desinstalador |

## Testing

```powershell
# En Windows (PowerShell 5.1+ o pwsh):
.opencode/scripts/test-installer.ps1 -Path install.ps1
```

### Lo que valida

1. **Integridad** — archivo existe, cuenta de líneas, función Main
2. **Sintaxis** — AST parsing sin errores
3. **COMMAND mode** — detecta `-and` bugs (cmdlet sin paréntesis envolvente)
4. **Splatting** — usa `@mainParams` en lugar de `@args`
5. **Funciones** — las 17 funciones requeridas existen
6. **Error handling** — `ErrorActionPreference = Stop`, `#Requires -Version 5.1`
7. **Parámetros** — parámetros de Main (`Version`, `Channel`, `NoModifyPath`, `UseMirror`, `Desktop`)
8. **URLs** — patrones de descarga usan variables, no valores hardcodeados

### CI

El workflow `.github/workflows/test-installer.yml` corre automáticamente en cada push que toque `install.ps1`:

- `validate` — test suite completo en `windows-latest` (pwsh)
- `syntax-windows-ps51` — validación sintaxis en `windows-2019` (PowerShell 5.1 nativo)
- `syntax-windows-pwsh` — validación sintaxis en `windows-latest` (pwsh)
- `release-integrity` — (manual via `workflow_dispatch`) verifica assets del release

### Validación manual de release

```bash
gh workflow run test-installer.yml -f release_tag=v1.17.13
```

Esto verifica que todos los assets esperados existan en el release y que los nombres de archivo coincidan con el tag.

## Bugs conocidos (y cómo evitarlos)

### COMMAND mode trap

**Problema**: PowerShell 5.1 trata `-and` como argumento de cmdlet cuando este aparece sin paréntesis.

```powershell
# MAL — COMMAND mode: -and se trata como string argumento de Test-Path
if (Test-Path $path -and $condition) { ... }

# BIEN — EXPRESSION mode: paréntesis fuerzan evaluación correcta
if ((Test-Path $path) -and $condition) { ... }
```

**Detección**: el test suite línea 91 busca el patrón `if (Command $arg -and` sin wrapping parens.

### Version mismatch en release assets

**Problema**: el zip binario debe matchear el tag del release porque `install.ps1` construye la URL con `$Version`.

```
Tag v1.17.13 → busca opencode_1.17.13_windows_amd64.zip
                (no opencode_1.17.12_windows_amd64.zip)
```

**Solución**: el CI valida que el asset exista con el nombre correcto.

## Release process

```bash
# 1. Fix en install.ps1, commit a dev
git add install.ps1 && git commit -m "fix(install): ..."
git push fork dev

# 2. Tag y release
git tag v1.17.14
git push fork v1.17.14

# 3. Crear release (gh)
gh release create v1.17.14 \
  --repo ivanfernadezm99/opencode \
  --title "..." \
  --notes "..." \
  install.ps1 install.bat uninstall.ps1 \
  opencode-desktop-win-x64.exe \
  opencode_1.17.14_windows_amd64.zip

# 4. Validar
gh workflow run test-installer.yml -f release_tag=v1.17.14
```
