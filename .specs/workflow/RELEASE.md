# RELEASE — `Simplicio-code`

Processo para cortar uma release de `Simplicio-code` (`developer-tools`, stack `monorepo`). Releases são tagueadas, automatizadas via GitHub Actions e reversíveis. Dono do processo: `wesleysimplicio-team`.

---

## 1. Princípios

- **SemVer estrito.** `MAJOR.MINOR.PATCH`. Quebra contrato = MAJOR, feature compatível = MINOR, fix compatível = PATCH.
- **Tag é fonte de verdade.** Nada de "release sem tag". Sem tag, sem deploy de produção.
- **CHANGELOG é contrato com o usuário.** Toda release tem entrada lida e revisada.
- **Rollback em minutos.** Toda release tem caminho documentado de volta.
- **Neste projeto, release-relevant change fecha só quando tudo fica sincronizado.** Isso inclui npm publicado, tag GitHub criada, GitHub Release correspondente e `main` limpa/sincronizada.

---

## 2. Bump de versão (SemVer)

Critério rápido:

| Mudança | Bump |
|---------|------|
| Bug fix interno, sem mudar API/UX | PATCH (`1.4.2` -> `1.4.3`) |
| Feature nova, retrocompatível | MINOR (`1.4.2` -> `1.5.0`) |
| Quebra de API, schema, contrato | MAJOR (`1.4.2` -> `2.0.0`) |
| Pre-release, RC | sufixo (`1.5.0-rc.1`) |

Local do número de versão depende do `monorepo`:
- Node: `package.json` campo `version`.
- Python: `pyproject.toml` ou `__version__.py`.
- Go: tag git é a versão (sem campo em arquivo).
- Rust: `Cargo.toml` campo `version`.
- .NET: `<Version>` no `.csproj` ou `Directory.Build.props`.
- PHP/Laravel: `composer.json` campo `version`.

Bump idempotente:

```bash
# Node
npm version minor --no-git-tag-version

# Python (uv/poetry)
uv version --bump minor

# manual: edita arquivo, commita
```

---

## 3. Atualizar `CHANGELOG.md`

Formato Keep a Changelog. Toda release tem bloco com seções abaixo (omita as vazias):

```markdown
## [1.5.0] - 2026-05-07

### Added
- Magic link login flow (auth) - task #12.

### Changed
- Checkout error messages now use i18n keys.

### Fixed
- Double-charge on 3DS retry (#48).

### Removed
- Legacy session cookie (deprecated em v1.3).

### Security
- Bump <lib> from 4.1.2 to 4.1.5 (CVE-2026-0001).
```

Regras:
- PT-BR no chat, **CHANGELOG sempre em inglês** (face pública do repo).
- Sem entrada genérica tipo "various improvements". Específico ou nada.
- `Security` ganha destaque, com CVE/advisory linkado.
- Entrada referencia task ou PR (#numero).

---

## 4. Criar tag

Após bump e CHANGELOG mergeados em `main`:

```bash
git checkout main
git pull --rebase origin main

# valida que CHANGELOG e package version batem
git tag -a v1.5.0 -m "Release 1.5.0"
git push origin v1.5.0
```

Tag deve apontar pro commit em que CHANGELOG e version foram atualizados. Não tag em commit antigo.

> Tag é imutável. Errou? Cria nova patch (`v1.5.1`) com correção. Nunca delete e re-cria tag publicada.

---

## 5. Deploy automático via GitHub Actions

Push da tag dispara `.github/workflows/deploy-prod.yml`:

```yaml
on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build artifact
        run: <comando build do STACK>
      - name: Push image / upload bundle
        run: <comando push>
      - name: Rollout production
        run: <comando rollout>
      - name: Smoke test
        run: npm run test:smoke -- --baseUrl=https://Simplicio-code.io
      - name: Notify
        run: <slack/discord/email pra TEAM>
```

Acompanhar o run:

```bash
gh run watch
gh run list --workflow=deploy-prod.yml --limit 5
```

Falhou? Workflow é idempotente, pode re-rodar. Se rollout passou mas smoke falhou, etapa de rollback dispara automático (próxima seção).

---

## 6. Smoke tests pós-deploy

Pequeno conjunto de cenários críticos rodando contra produção logo após o rollout. Objetivo: detectar regressão grande em < 5min.

Cobertura mínima:
- Health check `/healthz` retorna 200.
- Login com usuário de smoke completa fluxo.
- 1 fluxo crítico de `developer-tools` (ex: criar pedido, enviar mensagem, abrir conta).
- Métrica de erro (Sentry, Datadog) não spikou nos últimos 2min.

Smoke roda dentro do workflow `deploy-prod.yml`. Falha = rollback automático.

---

## 7. Rollback

Quando: smoke falhou, métrica spikou, usuários reportando incidente, sentry com taxa de erro > baseline.

### Estratégia: revert tag e redeploy da anterior

Mais rápido e seguro que tentar fix em produção.

```bash
# identifica tag anterior
gh release list --limit 5

# dispara redeploy da tag anterior
git checkout v1.4.2
gh workflow run deploy-prod.yml --ref v1.4.2

# acompanha
gh run watch
```

### Marca a release ruim

```bash
gh release edit v1.5.0 --notes "ROLLED BACK - see incident #INC-2026-05-07"
```

CHANGELOG ganha nota:

```markdown
## [1.5.0] - 2026-05-07 [ROLLED BACK]
> Rolled back at 14:32 UTC. See incident report INC-2026-05-07.
```

### Pós-rollback

- Postmortem em `.specs/incidents/INC-YYYY-MM-DD.md` em até 48h.
- Fix vai em PR normal (com teste regressivo) e tagueia próxima patch (`v1.5.1`).
- Atualiza skill/playbook se causa-raiz era processo, não código.

---

## 8. Pre-releases e RCs

Para mudanças grandes (MAJOR), considere RC antes da release final:

```bash
git tag v2.0.0-rc.1
git push origin v2.0.0-rc.1
```

- Workflow separado `deploy-rc.yml` envia pra ambiente `rc.Simplicio-code.io`.
- Beta testers usam por 3-7 dias antes do tag final `v2.0.0`.
- Bugs em RC viram patch no RC (`v2.0.0-rc.2`), não em PATCH SemVer ainda.

---

## 9. Checklist do release manager

- [ ] `main` verde (build, lint, unit, e2e).
- [ ] Versão bumpada conforme SemVer.
- [ ] `CHANGELOG.md` atualizado, revisado, em inglês.
- [ ] `package-lock.json` sincronizado com a versão atual.
- [ ] npm publicado na mesma versão de `package.json`.
- [ ] Tag criada apontando pro commit certo.
- [ ] GitHub Release criada/atualizada na mesma versão da tag.
- [ ] Workflow de deploy completou verde.
- [ ] Smoke tests passaram.
- [ ] Métricas estáveis nos primeiros 30min.
- [ ] Notificação pra `wesleysimplicio-team` enviada.
- [ ] Release notes publicadas (`gh release create v1.5.0 -F CHANGELOG.md`).

### Validação padrão deste repositório

Antes de publicar/taguear/criar release, executar:

```bash
npm run lint
npm test
npm run docs:build
npm run test:e2e -- --reporter=list,html
```

Em incidente, congelar releases até postmortem fechar com ação concreta no roadmap.
