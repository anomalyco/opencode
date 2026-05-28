---
name: conventional-commits
description: padronizar mensagens de commit seguindo Conventional Commits (type, scope opcional, subject curto, breaking change marcado)
---

# Skill: `conventional-commits`

Toda mensagem de commit deste projeto segue o padrão **Conventional Commits**. Isso habilita changelog automático, version bump por SemVer e leitura rápida do histórico. Sem exceção.

---

## Trigger

- Toda vez que rodar `git commit`.
- Antes de abrir PR (verificar histórico do branch).
- Quando rebase/squash consolidar commits — a mensagem final também segue o padrão.
- Quando o usuário pedir "faz commit", "commita as mudanças", "abre PR".

---

## Padrão

```
<type>(<scope>)?: <subject>

[<body opcional>]

[<footer opcional>]
```

- **type** (obrigatório, minúsculo): `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`.
- **scope** (opcional): área afetada em uma palavra (`auth`, `api`, `ui`, `deps`). Entre parênteses.
- **subject** (obrigatório): descrição curta no imperativo presente, minúsculo, sem ponto final, **máx 72 caracteres**.
- **body** (opcional): linhas explicando o "porquê", não o "o quê". Separado do subject por linha em branco. Wrap a 72 colunas.
- **footer** (opcional): referências a issue (`Closes #123`), co-autores, ou marcação de breaking change.

### Tipos — quando usar cada um

| Type | Quando |
| --- | --- |
| `feat` | Nova feature visível ao usuário |
| `fix` | Correção de bug |
| `docs` | Só documentação (README, JSDoc, comentários) |
| `style` | Formatação que não muda comportamento (espaços, ponto-e-vírgula) |
| `refactor` | Reestruturação sem mudar comportamento externo |
| `perf` | Melhoria de performance |
| `test` | Adicionar/atualizar testes |
| `build` | Sistema de build, dependências (`package.json`, `tsconfig`) |
| `ci` | Pipeline CI/CD (`.github/workflows`, scripts de deploy) |
| `chore` | Manutenção genérica que não cabe nas outras |
| `revert` | Reverte commit anterior (mensagem cita o SHA revertido) |

### Breaking change

Mudança incompatível com a versão anterior. **Duas formas válidas**, escolha uma:

1. **Bang após o type**: `feat!:`, `refactor!:`, `fix!:`.
2. **Footer explícito**: `BREAKING CHANGE: <descrição do impacto e migração>`.

Se possível, use as duas para deixar 100% claro.

---

## Exemplos

```text
feat(auth): add password reset flow via email link

fix(api): handle null user-agent header without crashing

docs: update README with new install steps

refactor(checkout): extract pricing logic into PriceCalculator

perf(search): debounce input to reduce API calls from 30 to 3 per typing burst

test(auth): cover expired-token edge case in login flow

build(deps): bump playwright to 1.45.0

ci: add Node 22 to test matrix

chore: remove unused dotenv import

revert: revert "feat(auth): add password reset flow via email link"

This reverts commit a1b2c3d4 — caused regression on existing reset tokens.
Closes #482

feat(api)!: rename /users endpoint to /accounts

BREAKING CHANGE: clients hitting /users must migrate to /accounts.
The old route returns 410 Gone. See migration guide in .specs/architecture/ADR-005.md.
```

---

## Steps

1. **Identifique o tipo** dominante da mudança. Se houve fix + refactor no mesmo diff, geralmente cabe `refactor` com nota no body sobre o fix incidental — ou separe em dois commits.
2. **Escolha o scope** (opcional) com base na pasta/módulo principal afetado. Mantenha consistência com scopes já usados no histórico.
3. **Escreva o subject** no imperativo: "add", "fix", "remove" — não "added", "fixes".
4. **Adicione body** se a motivação não for óbvia pelo subject. Explique o "porquê", referencie a task: `Refs #task-id`.
5. **Marque breaking change** quando aplicável (`!` no header e/ou `BREAKING CHANGE:` no footer).
6. **Verifique tamanho**: subject ≤ 72 chars, linhas do body ≤ 72.
7. **Commit**. Se o projeto usa `commitlint` no hook `commit-msg`, ele bloqueia mensagens fora do padrão — corrija e tente de novo.

---

## Definition of Done

- [ ] Mensagem segue `<type>(<scope>)?: <subject>` com type válido da lista.
- [ ] Subject ≤ 72 caracteres, imperativo, minúsculo, sem ponto final.
- [ ] Body (se presente) separado por linha em branco e com wrap em 72 colunas.
- [ ] Breaking change marcado com `!` e/ou footer `BREAKING CHANGE:`.
- [ ] `commitlint` passou (se configurado em `.commitlintrc` / hook `commit-msg`).
- [ ] Histórico do branch é coerente: sem commits "wip", "fix typo" pendurados — squash/rebase antes do PR.

---

## Notas

- Para SemVer automático: `feat` → minor; `fix`, `perf` → patch; `feat!`/`fix!`/`BREAKING CHANGE` → major.
- `chore` e `style` **não** geram bump de versão por padrão.
- Linter recomendado: `@commitlint/cli` + `@commitlint/config-conventional`. Hook em `.husky/commit-msg` ou `.claude/hooks/`.
- Spec oficial: <https://www.conventionalcommits.org/>.
