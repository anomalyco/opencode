---
name: jarvis-github-agentuse
description: "Guía de uso de herramientas GitHub para agentes (gh CLI, GitHub MCP, GraphQL API, REST API). Usar cuando se necesite interactuar con GitHub: issues, PRs, projects, releases, actions, secrets, labels. Cubre qué herramienta usar según el caso, limitaciones de GITHUB_TOKEN, diferencias classic vs fine-grained PAT, y patrones comunes."
---

# Jarvis — GitHub Agent Use

Qué herramienta de GitHub usar en cada situación y cómo sortear sus limitaciones.

## Herramientas disponibles

| Herramienta | Acceso | Ideal para |
|---|---|---|
| **gh CLI** (`gh api`, `gh issue`, `gh release`, etc.) | Todo (con token) | 90% de las operaciones |
| **GitHub MCP** | Issues, PRs, repos, users | Issues/PRs con formato rico |
| **GraphQL API** (`gh api graphql`) | Projects V2, mutations complejas | Kanban, campos personalizados |
| **REST API** (`gh api --method`) | Secrets, alerts, operaciones simples | CRUD directo |

## Regla general

1. **gh CLI** primero: `gh issue view`, `gh release list`, `gh secret set`, `gh label list`
2. **GraphQL** para Projects V2: `gh api graphql -F query=@file`
3. **REST** para operaciones no cubiertas: `gh api --method PATCH /repos/...`
4. **MCP** cuando gh CLI no llega o se necesita formato enriquecido

## Autenticación

### Tokens

| Tipo | Prefijo | Accede a Projects V2 | Scope |
|---|---|---|---|
| **Classic PAT** | `ghp_...` | ✅ Sí | `read:project`, `repo` |
| **Fine-grained PAT** | `github_pat_...` | ❌ No (solo org projects) | Repos específicos |
| **GITHUB_TOKEN** | `ghs_...` (Actions) | ❌ No | `contents: read/write`, `metadata: read` |

**Conclusión**: para CI que necesita Projects V2, usar **classic PAT** (`ghp_...`) como secreto `GH_PAT`.

### En CI

```yaml
env:
  GH_TOKEN: ${{ secrets.GH_PAT }}  # classic PAT con read:project
```

### Patrones

**GraphQL con archivo temporal** (evita problemas de escaping):
```python
import tempfile, subprocess, os
fd, fn = tempfile.mkstemp(suffix='.gql')
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    f.write(query)
r = subprocess.run(['gh', 'api', 'graphql', '-F', f'query=@{fn}'],
                   capture_output=True, encoding='utf-8', timeout=30)
os.remove(fn)
```

**Body largo con json.dumps** (para updateProjectV2DraftIssue):
```python
import json
safe_body = json.dumps(new_body)
mutation = f'mutation {{ updateProjectV2DraftIssue(input: {{draftIssueId: "...", body: {safe_body}}}) {{ clientMutationId }} }}'
```

**REST PATCH con archivo**:
```bash
echo '{"body": "new content"}' > /tmp/body.json
gh api --method PATCH repos/jaminsmoke/Jarvis/issues/84 --input /tmp/body.json
```

## Operaciones comunes

### Issues
```bash
gh issue view 84 --repo jaminsmoke/Jarvis --json title,body,state
gh issue edit 84 --repo jaminsmoke/Jarvis --title "nuevo titulo" --add-label security
gh issue list --repo jaminsmoke/Jarvis --state closed --label feature --limit 10
```

### Releases
```bash
gh release list --repo jaminsmoke/Jarvis
gh release view v0.1.4 --repo jaminsmoke/Jarvis --json tagName,isDraft,isLatest
gh release edit v0.1.4 --repo jaminsmoke/Jarvis --draft=false --latest
```

### Secrets
```bash
echo "token_value" | gh secret set GH_PAT --repo jaminsmoke/Jarvis
```

### Labels
```bash
gh label list --repo jaminsmoke/Jarvis --json name,id
gh label create v0.1.5 --repo jaminsmoke/Jarvis --color 0E8A16
```

### Actions / CI
```bash
gh run list --repo jaminsmoke/Jarvis --workflow ci-quality --limit 5
gh run view 31208918303 --repo jaminsmoke/Jarvis --json jobs
gh run view 31208918303 --repo jaminsmoke/Jarvis --log --job 92947871728
```

### Secret Scanning
```bash
gh api repos/jaminsmoke/Jarvis/secret-scanning/alerts --jq '.[] | select(.state=="open")'
gh api --method PATCH repos/jaminsmoke/Jarvis/secret-scanning/alerts/1 \
  -f state=resolved -f resolution=false_positive -f resolution_comment='...'
```

## Limitaciones conocidas

1. **Crear opciones en campo SingleSelect**: NO hay API. Solo UI (Project Settings → Fields → Edit → Add option).
2. **Crear campos nuevos en Project**: NO hay API. Solo UI.
3. **Fine-grained PAT**: no accede a user projects (solo org projects).
4. **GITHUB_TOKEN**: no accede a Projects V2, solo `contents` y `metadata`.
5. **groupBy del Kanban**: no hay API — se configura en la UI.
6. **DraftIssue body**: el mutation `updateProjectV2DraftIssue` requiere escapar el body con `json.dumps()`.
7. **graphql pagination**: los items del Project usan cursor-based pagination. Usar `first:100` + `after` + `pageInfo.hasNextPage`.
8. **fieldValues**: solo devuelve los primeros N valores. Si un campo no aparece, aumentar `first` (ej. `first: 10` en vez de `first: 3`).
