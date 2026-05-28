# INIT — Inicialização guiada do LLM Project Mapper

> 🇺🇸 English version: [INIT.en.md](INIT.en.md).

> Você é o **agente de inicialização**. O humano acabou de rodar `./bootstrap.sh` (ou `pwsh ./bootstrap.ps1`, ou `npx llm-project-mapper init`).
> Sua missão: completar o setup **lendo o projeto real**, **fazendo só as perguntas que faltam** e **mesclando** o que já existe — sem nunca destruir conteúdo do humano.
>
> CLIs compatíveis com agent loop nativo: **Claude Code**, **Codex CLI**, **Cursor Agent**, **Hermes Agent**, **OpenClaw**, **Aider** (Deepseek/Kimi/MiniMax/GLM via `--model`).
> Sem agent loop nativo (cole prompt manualmente): **GitHub Copilot CLI**.

---

## Regra zero — não destrua nada

Antes de qualquer Write/Edit, leia `.starter-meta.json` na raiz do repo. Ele é o contrato entre o `bootstrap` e você.

```jsonc
{
  "product_name": "...",
  "team": "...",
  "domain": "...",
  "stack": "...",
  "bootstrapped_at": "2026-05-08T19:45:00Z",
  "starter_version": "0.2.0",
  "existing_instruction_files": [".github/copilot-instructions.md"],
  "init_must_ask":   ["team", "domain", "vision_oneliner", "primary_personas"],
  "init_must_merge": [".github/copilot-instructions.md"],
  "read_only_globs": ["**/*.razor", "**/*.cs", "package.json", "..."]
}
```

Três regras inegociáveis, derivadas desse arquivo:

1. **`read_only_globs`** — Nenhum arquivo casando esses globs pode aparecer em `git diff`. Você lê, mas **não escreve**. Se precisa de informação dele, copie/cole no `.specs/` (parafraseado), não edite o original.
2. **`init_must_merge`** — Para cada caminho aqui: **leia** o conteúdo atual, **preserve a essência**, **mescle** com nossa estrutura padrão. Não reescreva do zero.
3. **`init_must_ask`** — Pergunte ao humano **somente** esses campos. Tudo mais (`product_name`, `stack`) já foi auto-detectado.

---

## Onde você pode escrever (whitelist)

Apenas estes caminhos são "starter-managed". **Tudo fora daqui é território do humano** — não toca.

```
.specs/**          .agents/**         .skills/**
.claude/**         .codex/**
.github/copilot-instructions.md
.github/copilot/**
.github/PULL_REQUEST_TEMPLATE.md
.github/ISSUE_TEMPLATE/**
.github/workflows/ci.yml
.github/workflows/dod.yml
AGENTS.md          CLAUDE.md          README.md          README.pt-BR.md
playwright.config.ts (apenas se ainda não existe ou se é template nosso)
```

Caminho fora dessa whitelist **e** que não é arquivo do template original → não escreve.

---

## Fluxo (5 fases — paraleliza tudo que dá)

### Fase 1 — Ler `.starter-meta.json` + perguntar o que falta

1. `Read .starter-meta.json`. Se não existe, abortar e instruir humano a rodar `./bootstrap.sh` primeiro.
2. Para cada item em `init_must_ask`, **pergunte ao humano em uma única mensagem** (não uma por vez):
   - **`team`** — Qual time é dono? (sugestão: `<valor de meta.team>`)
   - **`domain`** — Domínio de negócio em 1-3 palavras? (sugestão: `<valor de meta.domain>`)
   - **`vision_oneliner`** — Em 1 frase, qual problema esse produto resolve e pra quem?
   - **`primary_personas`** — Quem usa? (2-4 perfis: ex. `admin operacional`, `cliente final`, `analista financeiro`)
3. Persistir as respostas atualizando `.starter-meta.json` (adicionar/sobrescrever `team`, `domain`, `vision_oneliner`, `primary_personas`).
4. Se humano não responder algo, marcar `**TODO: humano preencher**` no doc e seguir.

### Fase 2 — Inspeção (1 agent dedicado, paralelo com início da Fase 3)

Spawna `@inspector` (subagent `Explore` ou `general-purpose`):

- Lê `.starter-meta.json` para conhecer a stack.
- Mapeia pastas de topo (`ls -la`, `find . -maxdepth 2 -type d`).
- Lê o `README.md` original (se existir e não for nosso template) — extrai descrição, badges, comandos. **Não modifica**.
- Detecta entidades por convenção da stack:
  - **Node/TS** → `**/models/**`, `**/entities/**`, `**/types/**`, `**/schemas/**`, `**/*.dto.ts`
  - **.NET** → `**/Models/**`, `**/Entities/**`, `**/DTOs/**`, `**/*.cs` com atributos `[Table]`/`[Key]`
  - **Python** → `**/models.py`, `**/schemas.py`, `**/entities/**`, classes `BaseModel`/`SQLAlchemy`
  - **Go** → `**/models/**`, structs com tag `db:` ou `json:`
  - **Rust** → `**/models.rs`, structs com `#[derive(Serialize)]`
  - **Flutter** → `lib/models/**`, classes `freezed`/`json_serializable`
  - **PHP/Laravel** → `app/Models/**`
  - **Ruby** → `app/models/**`
- Detecta integrações externas: imports `axios`/`fetch`/`HttpClient`/`requests`/`reqwest`, env vars (`*_URL`, `*_KEY`, `*_TOKEN`), connection strings.
- Detecta scripts/comandos reais: `package.json` `scripts`, `Makefile`, `composer.json` `scripts`, `pyproject.toml` `[tool.poetry.scripts]`, `*.csproj` targets.
- TODO/FIXME/HACK no código de produção (excluir `node_modules`/`vendor`/`dist`/`build`).
- Issues abertas via `gh issue list --limit 50` se `gh` autenticado.

**Output do inspector** — relatório markdown salvo em `.specs/journal/inspection-<YYYY-MM-DD>.md` com seções:
`Stack real`, `Estrutura de pastas`, `Entidades detectadas`, `Comandos úteis`, `Integrações`, `TODOs encontrados`, `Issues abertas`.

### Fase 3 — Preenchimento paralelo (6 agents num único message)

Após Fase 1 (perguntas respondidas) e com Fase 2 já rodando, dispare **em paralelo** (1 message com múltiplas chamadas `Agent`):

| Agent | Output | Insumo |
|---|---|---|
| `@vision-writer` | `.specs/product/VISION.md` | `vision_oneliner` + README original + descrição do `package.json`/`*.csproj`/`pyproject.toml` |
| `@domain-mapper` | `.specs/product/DOMAIN.md` (com Mermaid `erDiagram` real) | entidades detectadas pelo inspector |
| `@personas-writer` | `.specs/product/PERSONAS.md` | `primary_personas` + roles/permissions detectadas no código |
| `@design-mapper` | `.specs/architecture/DESIGN.md` (com Mermaid de boundaries reais) | estrutura de pastas + integrações + frameworks |
| `@patterns-extractor` | `.specs/architecture/PATTERNS.md` | naming/estrutura/convenções **reais** observadas no código (não inventa) |
| `@backlog-collector` | `.specs/sprints/BACKLOG.md` | TODOs + issues do `gh` |

### Fase 4 — Mesclar arquivos pré-existentes (sequencial — usa contexto da Fase 3)

Para **cada caminho** em `init_must_merge`:

1. `Read` o arquivo existente do humano.
2. Identifique a **essência**: comandos importantes, regras específicas do projeto, links internos, glossário, contatos, restrições de compliance.
3. Componha um arquivo novo com a estrutura do **template** do starter (Stack / Comandos / Workflow / DoD / Padrões / Onde encontrar contexto / Proibido / Skills / Custom agents) **+** seção `## Conteúdo preservado do <nome-original>` ao final, com a essência do humano.
4. `Write` no mesmo caminho. Diff resultante deve ser **adição enriquecedora**, nunca remoção do que o humano escreveu.
5. **Espelhamento obrigatório:** se você editou `AGENTS.md`, replique a mesma mudança em `CLAUDE.md` e em `.github/copilot-instructions.md`. Os três ficam alinhados (ou crie symlink: `ln -sf AGENTS.md CLAUDE.md`).

### Fase 5 — Atualizar comandos reais e validar

1. **`@instruction-updater`** — atualiza `AGENTS.md`/`CLAUDE.md`/`.github/copilot-instructions.md`:
   - Substitui a seção `## Comandos importantes` por comandos **reais** extraídos pelo inspector (não placeholders).
   - Adiciona links para os docs preenchidos em `.specs/`.
   - Adiciona seção `## Skills/Agents disponíveis` com o que existe em `.skills/` e `.agents/`.

2. **DoD checks**:
   - Todos os arquivos do tree existem (`AGENTS.md`, `CLAUDE.md`, `.specs/{product,architecture,workflow,sprints}/...`).
   - Sem placeholders `Simplicio-code`/`<TEAM>`/`<DOMAIN>`/`monorepo` remanescentes em starter-managed paths.
   - Mermaid blocks com sintaxe válida (sem acento em IDs, labels com espaço entre aspas).
   - Nenhum doc significativo abaixo de 30 linhas úteis.
   - **Verificação crítica:** `git status` **NÃO** deve listar nenhum arquivo casando `read_only_globs`. Se listar, algo escapou — reverta com `git checkout -- <arquivo>`.

3. **Reporte ao humano** o que ficou:
   - Arquivos preenchidos (lista).
   - Top 5 entidades detectadas.
   - Comandos identificados.
   - O que ficou como **TODO: humano preencher**.
   - Próxima ação sugerida (criar `sprint-01/SPRINT.md`, abrir primeira ADR, configurar branch protection, etc.).

---

## Limpeza opcional

Pergunta ao humano:

> "Apagar `_BOOTSTRAP.md`, `INIT.md`, `bootstrap.sh`, `bootstrap.ps1` agora? (s/N)"

Se `s`:

```bash
rm _BOOTSTRAP.md INIT.md bootstrap.sh bootstrap.ps1
git add -A
git commit -m "chore: remove starter bootstrap files after init"
```

Mantém `.starter-meta.json` (referência futura).

---

## Regras de execução

- **Idioma**: respostas/conteúdo gerado em **pt-BR**. Código (vars/funções/classes), commits, identificadores: **inglês**.
- **Não inventa** — se o código não dá pra extrair certa info, marca **`TODO: humano preencher`** explícito.
- **Concreto > genérico** — exemplos com nomes reais (entidades, rotas, comandos do projeto), não placeholders.
- **Sem emojis** em código fonte.
- **Mermaid válido** — IDs sem acento; labels com espaço entre aspas (`["Order Service"]`).
- **Paralelo agressivo** — qualquer trabalho independente vai num único message com múltiplas chamadas `Agent`.
- **Read-only é lei** — qualquer arquivo casando `read_only_globs` é intocável. Se aparecer em `git diff`, reverta.
- **Mesclar é a regra para `init_must_merge`** — nunca reescreva do zero, sempre componha por cima.
- **Sem dependências novas** sem perguntar.

---

## Checklist final do agent

- [ ] `.starter-meta.json` lido e atualizado com respostas do humano.
- [ ] `init_must_ask` perguntado **uma vez só**, em uma única mensagem.
- [ ] Inspector rodou e produziu relatório com entidades/comandos/integrações reais.
- [ ] 6 docs do `.specs/` preenchidos com info real (não placeholder).
- [ ] `init_must_merge` mesclado com essência preservada.
- [ ] `AGENTS.md` ↔ `CLAUDE.md` ↔ `.github/copilot-instructions.md` alinhados.
- [ ] `git status` não lista nenhum arquivo de `read_only_globs`.
- [ ] Sem placeholders `Simplicio-code`/`monorepo`/`<TEAM>`/`<DOMAIN>` remanescentes em starter paths.
- [ ] Resumo entregue ao humano: arquivos, entidades, comandos, TODOs, próxima ação.

---

**INIT.md é descartável após rodar 1x. Não persiste config aqui — persiste em `.specs/`.**
