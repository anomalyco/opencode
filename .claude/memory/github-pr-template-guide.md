# Guía: Crear Issues y PRs en anomalyco/opencode sin errores de template

## Problema recurrente

Los PRs creados reciben un comentario automático de `github-actions` diciendo:
> "This PR doesn't fully meet our contributing guidelines and PR template."

Esto sucede porque el campo `--body` no sigue el formato del template ubicado en `.github/pull_request_template.md`.

---

## 1. ANTES de crear un Issue

### Buscar duplicados PRIMERO

```bash
gh issue list --repo anomalyco/opencode --search "<keywords del bug>" --state all --limit 10
```

Ejemplo concreto (lo que debí hacer):
```bash
gh issue list --repo anomalyco/opencode --search "compaction tool call" --state all --limit 10
```

**Si ya existe:**
- Usar el número existente para asociar al PR con `--body "Closes #XXXX"`
- No crear issue duplicado

---

## 2. Crear un Issue (solo si no existe)

Template mínimo válido:
```markdown
### Bug Description

[Descripción clara del bug]

### Steps to Reproduce

1. [Paso 1]
2. [Paso 2]

### Expected Behavior

[Qué debería pasar]

### Actual Behavior

[Qué pasa en realidad]

### Environment

- OpenCode version: [ej. 1.14.19]
- OS: [ej. Windows 11]
```

Command:
```bash
git checkout -b fix/NUEVO-ISSUE-descripcion-corta
git push fork fix/NUEVO-ISSUE-descripcion-corta
gh issue create --title "fix: descripcion corta" --body-file issue-body.md
```

---

## 3. ANTES de crear un PR

### Paso A: Leer el PR template del repo

```bash
cat .github/pull_request_template.md
```

El template tiene 5 secciones OBLIGATORIAS:
1. **Issue for this PR** (closes #XXXX — OBLIGATORIO)
2. **Type of change** (checkboxes — al menos uno marcado con `[x]`)
3. **What does this PR do?** (descripción del cambio — OBLIGATORIO)
4. **How did you verify your code works?** (tests, typecheck, manual QA)
5. **Checklist** (2 checkboxes — `[x]` requerido)

### Paso B: Crear el body en un archivo temporal

```bash
cat > /tmp/pr-body.md << 'EOF'
### Issue for this PR

Closes #23709

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

[DESCRIPCION DEL FIX — por qué el cambio, qué hace, y cómo lo verifica]

### How did you verify your code works?

- [Checklist de verificación]

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
EOF
```

### Paso C: Crear el PR con --body-file (NO --body directo)

```bash
git checkout -b fix/XXXX-...
git add [archivos-cambiados]
git commit -m "fix(scope): descripcion concisa"
git push fork fix/XXXX-... --no-verify # si hay problemas de husky

git fetch origin
gh pr create --base dev \
  --head herjarsa:fix/XXXX-... \
  --title "fix(scope): descripcion en presente" \
  --body-file /tmp/pr-body.md
```

**IMPORTANTE:**
- Usar `--body-file` con un archivo temporal, NUNCA `--body` directo con texto largo
- El title usa conventional commits: `fix(scope): ...`, `feat(scope): ...`
- `fix` → bug, `feat` → feature
- Siempre referenciar el issue con `Closes #XXXX` en la primer línea del body

---

## 4. Errores comunes a EVITAR

| Error | Consecuencia | Solución |
|-------|-------------|----------|
| `--body "texto corto sin template"` | PR flagged automáticamente por github-actions | Usar `--body-file` con template completo |
| Sin `Closes #XXXX` | PR sin issue asociado | Siempre buscar issue existente primero |
| `[ ]` sin `[x]` en checkboxes | Template incompleto | Marcar `[x]` en al menos un type de change y checklist |
| Descripción "pasteada de AI sin entender" | PR puede ser IGNORADO | Escribir la descripción vos, corta y técnica |
| Faltar campo "What does this PR do?" | Rejected automáticamente | Es OBLIGATORIO |

---

## 5. Workflow recomendado (step-by-step)

1. **Detectar bug/idea**
2. **Buscar issue existente**:
   ```bash
   gh issue list --search "<keywords>" --state all
   ```
3. **Si no existe issue** → crear issue con `gh issue create`
4. **Crear branch**: `git checkout -b fix/XXXX-descripcion`
5. **Implementar fix** (delegar a subagent si es complejo)
6. **Verificar**:
   ```bash
   bun typecheck  # o el build del proyecto
   ```
7. **Commit**: `git commit -m "fix(scope): ..."`
8. **Push**: `git push fork fix/XXXX-descripcion --no-verify`
9. **Preparar body**: `cat > .tmp-body.md` con TODAS las secciones del template
10. **Crear PR**: `gh pr create --body-file .tmp-body.md`
11. **Eliminar archivo temporal**: `rm .tmp-body.md`

---

## Archivos de referencia en este repo

- Template: `.github/pull_request_template.md`
- Contributing: `CONTRIBUTING.md`

---

## Comandos de utilidad rápida

```bash
# Buscar issues existentes
gh issue list --search "compaction error" --state all -L 5

# Ver últimos comentarios de un PR
gh pr view 24290 --json comments --jq '.comments | last'

# Editar descripción de PR existente
gh pr edit 24290 --body-file nueva-descripcion.md

# Ver estado de tus PRs abiertos
gh pr status
```
