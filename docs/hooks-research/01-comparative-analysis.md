# Hooks no OpenCode: análise comparativa vs Claude Code

> Análise comparativa do sistema de hooks/plugin events entre OpenCode e Claude Code,
> baseada em código real do fork `anomalyco/opencode` (commit `d2efd81`) e na
> estrutura revelada pelo leak do Claude Code de março/2026.

## TL;DR

O OpenCode **já tem um sistema de hooks maduro** via `packages/plugin/src/index.ts` e
`plugin.trigger(name, input, output)` em `packages/opencode/src/session/prompt.ts`.
Ele cobre ~70% do que os hooks do Claude Code (`commands/hooks/`, `hooks/`) fazem.

O gap principal **não é implementar hooks do zero** — é **preencher eventos que
faltam**, ajustar semântica em alguns existentes, e melhorar a experiência de
configuração (descoberta, matcher syntax, async fire-and-forget).

---

## 1. Inventário real: hooks OpenCode hoje

### 1.1 Definição (de `packages/plugin/src/index.ts:222-334`)

```ts
export interface Hooks {
  dispose?: () => Promise<void>
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook
  provider?: ProviderHook

  "chat.message"?: (input, output) => Promise<void>
  "chat.params"?: (input, output) => Promise<void>
  "chat.headers"?: (input, output) => Promise<void>
  "permission.ask"?: (input, output) => Promise<void>
  "command.execute.before"?: (input, output) => Promise<void>
  "tool.execute.before"?: (input, output) => Promise<void>
  "shell.env"?: (input, output) => Promise<void>
  "tool.execute.after"?: (input, output) => Promise<void>

  "experimental.chat.messages.transform"?: (input, output) => Promise<void>
  "experimental.chat.system.transform"?: (input, output) => Promise<void>
  "experimental.provider.small_model"?: (input, output) => Promise<void>
  "experimental.session.compacting"?: (input, output) => Promise<void>
  "experimental.compaction.autocontinue"?: (input, output) => Promise<void>
  "experimental.text.complete"?: (input, output) => Promise<void>
  "tool.definition"?: (input, output) => Promise<void>
}
```

Padrão: `(input, output) => Promise<void>`. Hooks podem **mutar `output` por referência**
(ver `plugin.trigger` em `packages/opencode/src/session/prompt.ts:307`).

### 1.2 Onde são disparados

Caminhos reais verificados:

| Hook | Arquivo | Linha |
|------|---------|-------|
| `tool.execute.before` (task) | `packages/opencode/src/session/prompt.ts` | 308 |
| `tool.execute.after` (task) | `packages/opencode/src/session/prompt.ts` | 390 |
| `chat.message` | `packages/opencode/src/session/prompt.ts` | 1000 |
| `experimental.chat.messages.transform` | `packages/opencode/src/session/prompt.ts` | 1255 |
| `tool.execute.before`/`after` (bash/read/edit/write) | `packages/opencode/src/session/tools.ts` | 107, 122, 176, 209, 259, 292, 339, 374, 403, 421 |

Padrão consistente: cada tool execution emite `before` (muda args) e `after`
(muda title/output/metadata).

---

## 2. Mapeamento: Claude Code → OpenCode

Baseado no leak do harness do Claude Code (`claude_code_ts_snapshot`),
os hooks/eventos que o sistema Claude Code tem são:

| Categoria Claude Code | OpenCode | Status |
|-----------------------|----------|--------|
| `PreToolUse` | `tool.execute.before` | ✅ equivalente |
| `PostToolUse` | `tool.execute.after` | ✅ equivalente |
| `UserPromptSubmit` | `chat.message` | ✅ equivalente |
| `Stop` | (ausente) | ❌ gap |
| `SubagentStop` | (ausente) | ⚠️ parcial (task.tool via `tool.execute.after`) |
| `Notification` | (ausente) | ❌ gap |
| `SessionStart` | (ausente) | ❌ gap |
| `SessionEnd` | `dispose` | ⚠️ parcial |
| `PreCompact` | `experimental.session.compacting` | ✅ equivalente |
| `PermissionRequest` | `permission.ask` | ✅ equivalente |
| `PostCompact` | (ausente) | ❌ gap |
| Matcher syntax por tool name | ❌ não tem | ❌ gap |
| Matcher syntax por regex de prompt | ❌ não tem | ❌ gap |
| Hooks shell (executar comando externo) | ⚠️ via plugin code | ⚠️ workaround |
| Hooks HTTP/webhook | ❌ não tem | ❌ gap |
| Async fire-and-forget | ⚠️ depende de trigger impl | ⚠️ incerto |
| Blocking + modify output | ✅ via `output` mutation | ✅ |
| Hook logging/telemetry próprio | ❌ não tem | ❌ gap |

---

## 3. Gaps concretos (o que falta)

### 3.1 **Stop hook** — sinaliza fim de turno do agente

Claude Code define `Stop` que dispara quando o agente termina um turno.
OpenCode não tem. **Workaround atual:** escutar `tool.execute.after` com
matcher "último tool call" — frágil.

**Valor:** permite cleanup (notificações, métricas, rollback, commit).

### 3.2 **SessionStart / SessionEnd (limpos)**

Hoje só tem `dispose` no hook final. Falta:
- `SessionStart` — antes do primeiro tool call. Permite setup customizado.
- `SessionEnd` — após `dispose`, com distinção de cleanup.

### 3.3 **Matcher syntax**

Claude Code permite `matcher` em `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write", "hooks": [...] }
    ]
  }
}
```

OpenCode atual: **hooks disparam para todas as tools**. Sem filtro.

Plugin author precisa fazer `if (input.tool === "bash")` manualmente.
Funciona, mas incentiva código duplicado e difícil de auditar.

### 3.4 **Shell hooks (comandos externos)**

Claude Code suporta executar binário externo como hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "./scripts/check-bash-safety.sh" }
        ]
      }
    ]
  }
}
```

OpenCode só tem **plugin code hooks** (TS/JS). Não tem shell hook nativo.
Usuário que quiser hook shell precisa escrever um plugin que faz
`Bun.spawn` internamente — fricção alta.

**Valor:** democratiza. DevOps/sysadmin sem TS consegue adicionar validação.

### 3.5 **Notification hook**

Claude Code dispara `Notification` em eventos de background (compactação
concluída, idle timeout, etc). OpenCode não tem canal dedicado.

**Valor:** permite webhook pra Slack/Discord quando sessão longa.

### 3.6 **SubagentStop dedicado**

Hoje: `tool.execute.after` com `tool === "task"` indica fim de sub-agent.
Funciona, mas sem semântica própria: não distingue "subagent terminou OK" de
"subagent falhou". Não tem `error` no input.

### 3.7 **Hook telemetry**

Cada hook call deveria emitir evento próprio (`HookInvoked` com nome, duração,
resultado). Hoje hook execution não aparece nos logs estruturados.

---

## 4. Onde os hooks OpenCode são SUPERIORES ao Claude Code

Para não cair em viés negativo:

### 4.1 **`tool.definition` hook**

OpenCode permite **modificar o schema da tool que o LLM vê**:

```ts
"tool.definition"?: (input, output) => Promise<void>
```

Isso permite **esconder parameters, renomear, injetar descrições contextuais**.
Claude Code não tem — tools são estáticas.

**Valor:** multi-tenant (empresa esconde fields internos de subcontractors),
personas (agente "junior" vê só subset).

### 4.2 **`chat.params` + `chat.headers`**

Permite modificar temperatura, topP, topK, **maxOutputTokens**, options
provider-specific (OpenRouter, Anthropic cache control), **e headers HTTP**.

Claude Code expõe temperature/config via slash command, mas não tem hook
que ajusta **dinamicamente por turno**.

**Valor:** cost control adaptativo (max tokens menor em tarefas simples),
A/B test de params em produção.

### 4.3 **`shell.env` hook**

Injeta env vars em **todo shell command** baseado em cwd/sessionID/callID.

Claude Code tem `permissions.sandbox.env` mas é estático. OpenCode hook é
**dinâmico por chamada**.

**Valor:** multi-tenant secrets (cada workspace vê só suas keys), tracing IDs.

### 4.4 **`experimental.chat.system.transform`**

Modifica o **system prompt inteiro** dinamicamente. Claude Code não permite
(ou só via `--append-system-prompt` flag estático).

**Valor:** A/B test de system prompts, persona switching, context-aware.

### 4.5 **`experimental.text.complete`**

Dispara **token a token** durante streaming. Permite mutação real-time
(p.ex. censurar PII antes do user ver).

Claude Code: `--output-format stream-json` é read-only.

**Valor:** compliance (PII detection em tempo real), i18n on-the-fly.

---

## 5. Esforço realista pra preencher os gaps

Assumindo 1 dev senior full-time, familiarizado com codebase OpenCode
(Effect-TS + Bun runtime).

| Gap | Esforço | Risco | Prioridade |
|-----|---------|-------|------------|
| Stop hook | 1-2 semanas | Baixo | **Alta** |
| SessionStart/SessionEnd | 1-2 semanas | Baixo | **Alta** |
| Matcher syntax | 2-3 semanas | Médio | **Alta** |
| Shell hooks nativos | 3-4 semanas | Médio | Média |
| Notification hook | 1 semana | Baixo | Média |
| SubagentStop dedicado | 1 semana | Baixo | Baixa |
| Hook telemetry | 1-2 semanas | Baixo | Baixa |
| **Total MVP (Alta)** | **4-7 semanas** | | |
| **Total completo** | **10-15 semanas** | | |

### Recomendações pragmáticas

**Fazer primeiro (alto valor, baixo risco):**

1. **Stop hook** — 1-2 semanas. Resolve caso de uso "notificar fim de turno"
   sem reescrever nada. Trigger natural: quando `tool.execute.after` é o último
   do turno.

2. **Matcher syntax** — 2-3 semanas. Permite usuários configurarem "só rodar
   em Bash + Edit" sem escrever plugin. **ROI alto**: reduz atrito pra
   90% dos casos.

3. **SessionStart/SessionEnd** — 1-2 semanas. Complementa `dispose` com semântica
   clara. Permite init/cleanup plugins.

**Fazer depois:**

4. **Shell hooks nativos** — 3-4 semanas. Valor real mas trabalho grande.
   Requer definir protocolo de input/output (JSON via stdin/stdout).

**Não fazer agora:**

5. Notification hook — só faz sentido com shell hooks ou HTTP hooks.
   Fazer junto com #4.

6. SubagentStop dedicado — `tool.execute.after` com `tool === "task"` resolve
   80% do caso.

7. Hook telemetry — nice-to-have. Adiar até ter demanda real.

---

## 6. Proposta de design (alto nível)

Ver `RFC-001-hooks-extension.md` neste mesmo diretório para detalhes.

Resumo: introduzir **`hooks.ts`** em `packages/core/src/` com:

- Novos eventos: `stop`, `session.start`, `session.end`, `notification`
- Matcher config em `opencode.json` (estilo Claude Code)
- Shell hook execution via `Bun.spawn` (mesma runtime OpenCode)
- Hook invocation log no sistema de eventos existente

Sem mudar contrato de `Hooks` interface — só **adicionar novos campos**.

---

## 7. Conclusão

OpenCode **não precisa de hook system novo**. Precisa de:
- 3-5 eventos novos (`stop`, `session.start`, `session.end`)
- 1 mecanismo de configuração (matcher syntax)
- 1 transporte alternativo (shell)

Tudo **aditivo**, nada breaking. 4-7 semanas de trabalho focado
coloca OpenCode em paridade com Claude Code em hook surface, **mantendo
as vantagens que já tem** (`tool.definition`, `chat.params`, `shell.env`).

## Anexos

### A. Lista completa de tool hooks disparados em `packages/opencode/src/session/tools.ts`

```text
107: tool.execute.before  (BashTool)
122: tool.execute.after   (BashTool)
176: tool.execute.before  (ReadTool)
209: tool.execute.after   (ReadTool)
259: tool.execute.before  (WriteTool)
292: tool.execute.after   (WriteTool)
339: tool.execute.before  (EditTool)
374: tool.execute.after   (EditTool)
403: tool.execute.before  (MultiEditTool)
421: tool.execute.after   (MultiEditTool)
```

Padrão: cada tool dispara `before` (muda args) e `after` (muda output/metadata/title).
Consistência observada, não há tool que pula o `after`.

### B. Hooks no `prompt.ts`

```text
308: tool.execute.before  (TaskTool - subagent dispatch)
390: tool.execute.after   (TaskTool - subagent complete)
1000: chat.message        (user message received)
1255: experimental.chat.messages.transform  (LLM history reshape)
```

Faltam neste arquivo: `chat.params`, `chat.headers`, `permission.ask`,
`shell.env`, `experimental.chat.system.transform`. Sugere que há outros
arquivos onde esses disparam (não mapeados nesta análise).