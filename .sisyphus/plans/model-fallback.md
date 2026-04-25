# Plan de Implementación: Model Fallback System

## TL;DR

> Implementar un sistema de fallback entre modelos LLM que active automáticamente ante cualquier fallo del modelo primario. Soporta cadenas de fallback ordenadas (`modeloA → modeloB → modeloC`) configurable tanto a nivel global como por agente/subagente, con herencia del padre + posibilidad de override.
>
> **Deliverables**:
> - Schema de config con `fallback_model: string[]`
> - Resolución de fallback en agentes y subagentes
> - Integración en `processor.ts` con retry por modelo + fallback a siguiente
> - Tests de cobertura
>
> **Estimated Effort**: XL (refactor + new feature)
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: Config schema → Agent merge → Prompt resolution → Processor integration → Tests

---

## Context

### Original Request
Crear un sistema fallback interno en OpenCode que permita configurar cadenas de modelos alternativos. Si un modelo falla, se intenta con el siguiente en la cadena. Debe funcionar tanto para agentes principales como subagentes, con herencia de config.

### Interview Summary
**Key Discussions**:
- Trigger de fallback: **cualquier fallo del modelo** (post-retry exhaustivo del modelo actual)
- Tipo de fallback: **cadena de fallback** (modeloA → modeloB → modeloC)
- Herencia en subagentes: **ambas** — hereda del padre, pero puede sobreescribir con config propia
- Scope: NO incluye UI, solo config por archivo/CLI

### Research Findings
- El retry actual (`retry.ts`) reintenta el MISMO modelo con backoff — NO hay switch de modelo
- `provider.ts:getSmallModel` ya tiene patrón de `priority = [...]` recorrido linealmente — reutilizar
- `config/agent.ts` usa `Schema.StructWithRest` — keys desconocidas caen en `options`; hay que agregar a `KNOWN_KEYS`
- `processor.ts:568` aplica `Effect.retry` sobre el stream — punto de integración ideal
- El flujo de resolución actual: `input.model → ag.model → lastModel → defaultModel`
- Subagentes heredan modelo del padre en `tool/task.ts:102`

### Metis Review
*Auto-review (Metis skipped por demanda del usuario; self-audit aplicado)*
**Identified Gaps** (addressed):
- ¿Cómo se pasa la cadena entre capas? → Se resuelve en agent runtime, se lee en processor
- ¿Persistencia en DB? → NO; fallback chain es runtime-only desde config
- ¿Tests de retry exhaustivo? → Incluidos en wave de tests
- ¿Documentación de config? → Incluido en commit strategy

---

## Work Objectives

### Core Objective
Agregar soporte para cadenas de fallback de modelos en OpenCode, configurables por agente y globales, que se activen secuencialmente tras agotarse los reintentos del modelo actual.

### Concrete Deliverables
- `packages/opencode/src/config/agent.ts`: nuevo campo `fallback_model` en `AgentSchema`
- `packages/opencode/src/config/config.ts`: nuevo campo `fallback_model` en config global
- `packages/opencode/src/agent/agent.ts`: `fallbackChain` en `Agent.Info` + merge logic
- `packages/opencode/src/provider/provider.ts`: helper `resolveFallbackChain`
- `packages/opencode/src/session/prompt.ts`: adaptar resolución de modelo para propagar chain
- `packages/opencode/src/tool/task.ts`: propagar fallback chain a subagentes
- `packages/opencode/src/session/processor.ts`: loop de fallback post-retry exhaustivo
- Tests en `packages/opencode/test/` para cada capa

### Definition of Done
- [ ] Config con `fallback_model: ["opencode/gpt-5-nano", "anthropic/claude-haiku-4-5"]` parsea correctamente
- [ ] Agente con fallback falla → retry → switch a siguiente modelo → retry → suceso
- [ ] Subagente sin config propia hereda fallback del padre
- [ ] Subagente con config propia usa su propia cadena
- [ ] Todos los tests existentes siguen pasando (`bun test` from package dir)

### Must Have
- Fallback funciona para cualquier fallo del modelo post-retry
- Cadena ordenada de modelos (mínimo 0, máximo ilimitado)
- Herencia padre→subagente con override posible
- Configuración tanto global como por agente
- Backoff normal se respeta por cada modelo individualmente

### Must NOT Have (Guardrails)
- NO tocar la lógica de retry existente (`retry.ts`) — solo reutilizarla
- NO cambiar schema de mensajes en DB (MessageV2) — fallback es runtime-only
- NO agregar UI/TUI para configurar fallback (solo config por archivo)
- NO cambiar el comportamiento por defecto cuando fallback_chain está vacío
- NO usar `any` type
- NO agregar Co-Authored-By en commits
- NO ejecutar `tsc` directamente (usar `bun typecheck` desde package dir)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: SÍ — `bun test` en `packages/opencode`
- **Automated tests**: Tests-after (se agregan tests tras implementación)
- **Framework**: bun test (existente en repo)
- **Si TDD**: N/A; se usa tests-after por ser feature nuevo

### QA Policy
Toda tarea DEBE incluir Agent-Executed QA Scenarios.

- **Config/Agent**: Validar parsing con REPL de bun
- **Processor**: Simular error de modelo y verificar fallback (más difícil; se usa `Effect` mocking)
- **API/Integration**: curl contra endpoint si aplica; para este caso, ejecución de tests

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - Types + Config):
├── Task 1: Agregar fallback_model a AgentSchema (config/agent.ts)
├── Task 2: Agregar fallback_model a Config global (config/config.ts)
└── Task 3: Agregar fallbackChain a Agent.Info + merge logic (agent/agent.ts)

Wave 2 (Core Resolution - MAX PARALLEL):
├── Task 4: Implementar resolveFallbackChain en Provider (provider/provider.ts)
├── Task 5: Propagar fallback chain en prompt resolution (session/prompt.ts)
└── Task 6: Propagar fallback chain en subagent task (tool/task.ts)

Wave 3 (Execution Integration):
├── Task 7: Implementar loop de fallback en processor (session/processor.ts)
└── Task 8: Clasificar errores para model-fallback vs fatal (session/retry.ts o processor.ts)

Wave 4 (Tests):
├── Task 9: Tests de config parsing (config/agent + config/config)
├── Task 10: Tests de resolución de fallback (agent + prompt + tool/task)
└── Task 11: Tests de integración en processor (simulación de fallo + fallback)

Wave FINAL (Verification - 4 reviews paralelos, luego okay del usuario):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
├── Task F3: Real Manual QA (unspecified-high)
└── Task F4: Scope Fidelity Check (deep)
```

### Dependency Matrix

- **1, 2, 3**: - - 4, 5, 6, 3
- **4**: 3 - 5, 6, 7, 2
- **5**: 3 - 7, 2
- **6**: 3 - 7, 2
- **7**: 4, 5, 6 - F1-F4, 4
- **8**: 7 - F1-F4, 4
- **9**: 1, 2 - F1-F4, 4
- **10**: 3, 5, 6 - F1-F4, 4
- **11**: 7, 8 - F1-F4, 4

### Agent Dispatch Summary

- **W1**: **3** tasks → T1 `quick`, T2 `quick`, T3 `quick`
- **W2**: **3** tasks → T4 `quick`, T5 `deep`, T6 `quick`
- **W3**: **2** tasks → T7 `deep`, T8 `deep`
- **W4**: **3** tasks → T9 `unspecified-high`, T10 `unspecified-high`, T11 `unspecified-high`
- **FINAL**: **4** tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [ ] 1. Agregar `fallback_model` a `AgentSchema` (`config/agent.ts`)

  **What to do**:
  - Extender `AgentSchema` con campo `fallback_model: Schema.optional(Schema.mutable(Schema.Array(ConfigModelID)))`
  - Agregar `"fallback_model"` al array `KNOWN_KEYS` (línea ~55)
  - El `normalize` debe parsear cada string con `Provider.parseModel` (existente en `provider.ts:1707`) — seguir patrón de `model` (línea ~250 en `agent/agent.ts`)
  - Verificar que keys desconocidas no caigan en `options` para este campo (estará en `KNOWN_KEYS`)

  **Must NOT do**:
  - NO modificar `options` handling (cualquier key extra sigue cayendo ahí)
  - NO cambiar tipos de campos existentes
  - NO usar `any` type

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Cambio aislado en schema de config, tipo-safe con Effect Schema

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 2 y 3)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3, 5, 6
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/config/agent.ts:55` — `KNOWN_KEYS`
  - `packages/opencode/src/config/agent.ts:101` — `AgentSchema` definition
  - `packages/opencode/src/config/model-id.ts` — `ConfigModelID` definition
  - `packages/opencode/src/provider/provider.ts:1707` — `Provider.parseModel` function

  **Acceptance Criteria**:
  - [ ] `AgentSchema` acepta y valida `fallback_model: ["opencode/gpt-5-nano"]`
  - [ ] `bun typecheck` desde `packages/opencode/` → 0 errores

  **QA Scenarios**:
  ```
  Scenario: Parsing de fallback_model válido
    Tool: Bun REPL
    Preconditions: Repo clonado, dependencias instaladas
    Steps:
      1. Importar `ConfigAgent` desde `src/config/agent.ts`
      2. Parsear objeto `{ model: "opencode/gpt-5", fallback_model: ["opencode/gpt-5-nano", "anthropic/claude-haiku"] }`
      3. Assert `result.fallback_model.length === 2`
    Expected Result: Parsing exitoso sin errores de validación
    Evidence: .sisyphus/evidence/task-1-parse-valid.md

  Scenario: Parsing de fallback_model inválido
    Tool: Bun REPL
    Preconditions: mismo setup
    Steps:
      1. Parsear `{ fallback_model: ["modelo-invalido"] }` (sin provider/)
      2. Assert que lanza error de validación
    Expected Result: Error de `ConfigModelID` (debe incluir "/")
    Evidence: .sisyphus/evidence/task-1-parse-invalid.md
  ```

  **Commit**: group with Wave 1
  - Message: `feat(config): add fallback_model to AgentSchema`
  - Files: `packages/opencode/src/config/agent.ts`

- [ ] 2. Agregar `fallback_model` a Config global (`config/config.ts`)

  **What to do**:
  - Agregar `fallback_model: Schema.optional(Schema.mutable(Schema.Array(ConfigModelID)))` al schema `Config.Info` (siguiendo convención de `disabled_providers` en línea ~133)
  - Agregar a `mergeConfig` (línea ~50) para que herede/merge fallback_model entre configs padre→hijo (usar `mergeArray` o `overwrite` según semántica)
  - Determinar merge strategy: ¿concatenar o reemplazar? → **reemplazar** (override completo, igual que `model`)

  **Must NOT do**:
  - NO modificar merge de otros campos
  - NO usar `any`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 1 y 3)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/config/config.ts:133` — `disabled_providers` pattern
  - `packages/opencode/src/config/config.ts:50` — `mergeConfig` function

  **Acceptance Criteria**:
  - [ ] `Config.Info` acepta `fallback_model` array
  - [ ] `mergeConfig` reemplaza fallback_model correctamente (no concatena indiscriminadamente)

  **QA Scenarios**:
  ```
  Scenario: Merge de config con fallback_model
    Tool: Bun REPL
    Steps:
      1. Crear config A con `fallback_model: ["a/1"]`
      2. Crear config B con `fallback_model: ["b/2"]`
      3. Llamar `mergeConfig(A, B)`
      4. Assert resultado tiene `fallback_model: ["b/2"]` (reemplazo, no merge)
    Expected Result: Override completo
    Evidence: .sisyphus/evidence/task-2-merge-config.md
  ```

  **Commit**: group with Wave 1
  - Message: `feat(config): add fallback_model to global Config`
  - Files: `packages/opencode/src/config/config.ts`

- [ ] 3. Agregar `fallbackChain` a `Agent.Info` + merge logic (`agent/agent.ts`)

  **What to do**:
  - Extender Zod schema `Agent.Info` (líneas 27-48) con campo `fallbackChain: z.array(ModelRefSchema).optional()`
  - En el loop de merge de `cfg.agent` (línea ~236), agregar asignación:
    ```ts
    if (value.fallback_model) {
      const chain = value.fallback_model.map(Provider.parseModel)
      agents[name].fallbackChain = chain
    }
    ```
    (Seguir exacto patrón de `model` en línea ~250)
  - Asegurar que `fallbackChain` se pase correctamente al crear agentes nativos y al mergear custom

  **Must NOT do**:
  - NO modificar campos existentes del schema
  - NO alterar lógica de otro campo

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 1 y 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5, 6, 10
  - **Blocked By**: Task 1 (schema), Task 2 (opcional, si queremos fallback global)

  **References**:
  - `packages/opencode/src/agent/agent.ts:27` — `Agent.Info` schema
  - `packages/opencode/src/agent/agent.ts:236` — Config merge loop
  - `packages/opencode/src/agent/agent.ts:250` — Patrón de `Provider.parseModel` para `model`

  **Acceptance Criteria**:
  - [ ] `Agent.Service` carga agentes con `fallbackChain` parseado
  - [ ] `bun typecheck` pasa

  **QA Scenarios**:
  ```
  Scenario: Agente con fallback chain
    Tool: Bun REPL
    Steps:
      1. Crear mock config con `agent: { "my-agent": { model: "a/1", fallback_model: ["b/2", "c/3"] } }`
      2. Cargar `Agent.Service` con esa config
      3. Buscar agente "my-agent"
      4. Assert `agent.fallbackChain.length === 2`
      5. Assert `agent.fallbackChain[0].providerID === "b"`
    Expected Result: Array parseado correctamente
    Evidence: .sisyphus/evidence/task-3-agent-fallback.md
  ```

  **Commit**: group with Wave 1
  - Message: `feat(agent): add fallbackChain to Agent.Info and merge logic`
  - Files: `packages/opencode/src/agent/agent.ts`

- [ ] 4. Implementar `resolveFallbackChain` en Provider (`provider/provider.ts`)

  **What to do**:
  - Crear función `resolveFallbackChain` (o similar) que reciba un array de `{ providerID, modelID }` y devuelva `Effect.Effect<Provider.Model | undefined>`
  - Iterar la cadena y devolver el **primer** modelo que `getModel` resuelva exitosamente (patrón copiado de `getSmallModel:1605`)
  - Si ninguno resuelve, devolver `undefined` (o lanzar error específico)
  - Agregar test unitario en `test/provider/provider.test.ts`

  **Must NOT do**:
  - NO modificar `getSmallModel` (a menos que se refactorice para compartir logic)
  - NO cambiar API pública de `getModel` (añadir función nueva)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 5 y 6, después de Wave 1)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 3

  **References**:
  - `packages/opencode/src/provider/provider.ts:1605` — `getSmallModel` priority loop pattern
  - `packages/opencode/src/provider/provider.ts:1707` — `Provider.parseModel` helper

  **Acceptance Criteria**:
  - [ ] `resolveFallbackChain` devuelve modelo disponible o undefined
  - [ ] Tests unitarios pasan

  **QA Scenarios**:
  ```
  Scenario: Resolución de cadena con modelo disponible
    Tool: Bun REPL
    Steps:
      1. Mock provider con modelos "a/1" (no disponible) y "b/2" (disponible)
      2. Llamar `resolveFallbackChain(["a/1", "b/2"])`
      3. Assert devuelve modelo "b/2"
    Expected Result: Devuelve primer modelo disponible
    Evidence: .sisyphus/evidence/task-4-resolve-chain.md

  Scenario: Cadena vacía o sin modelos disponibles
    Tool: Bun REPL
    Steps:
      1. Mock sin modelos disponibles
      2. Llamar `resolveFallbackChain(["a/1", "b/2"])`
      3. Assert devuelve undefined
    Expected Result: undefined (no error)
    Evidence: .sisyphus/evidence/task-4-resolve-empty.md
  ```

  **Commit**: group with Wave 2
  - Message: `feat(provider): add resolveFallbackChain helper`
  - Files: `packages/opencode/src/provider/provider.ts`, `packages/opencode/test/provider/provider.test.ts`

- [ ] 5. Propagar fallback chain en resolución de prompt (`session/prompt.ts`)

  **What to do**:
  - En `createUserMessage` (línea 935), modificar la resolución de `model` para que, si `ag.fallbackChain` existe, no solo devuelva el modelo primario sino que prepare el array completo
  - Posiblemente extender `PromptInput` (o la estructura interna) para incluir `fallbackModels?: Array<{ providerID, modelID }>`
  - Modificar `getModel` (línea 898) para aceptar un modelo, no la cadena; la cadena se itera en processor
  - La función `handleSubtask` (línea 540) también debe propagar la cadena si el subtask tiene `model`
  - **Nota crítica**: `prompt.ts` NO debe hacer fallback él mismo — eso es trabajo del processor. Solo debe asegurar que la cadena llegue al processor.

  **Must NOT do**:
  - NO implementar lógica de retry/fallback en prompt.ts (solo pasar datos)
  - NO modificar la firma de `getModel` si no es necesario

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 4 y 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 3

  **References**:
  - `packages/opencode/src/session/prompt.ts:935` — `createUserMessage` model resolution
  - `packages/opencode/src/session/prompt.ts:898` — `getModel` function
  - `packages/opencode/src/session/prompt.ts:540` — `handleSubtask` task model resolution

  **Acceptance Criteria**:
  - [ ] PromptInput (o message.user) incluye cadena de fallback cuando agente la tiene configurada
  - [ ] SubtaskModel hereda la cadena si subagente no tiene config propia

  **QA Scenarios**:
  ```
  Scenario: Mensaje con fallback chain
    Tool: Bun REPL + test runner
    Steps:
      1. Crear agente con fallbackChain ["b/2", "c/3"]
      2. Llamar createUserMessage para ese agente
      3. Assert que el resultado incluye la cadena de fallback
    Expected Result: Prompt/user message contiene datos de fallback
    Evidence: .sisyphus/evidence/task-5-prompt-fallback.md
  ```

  **Commit**: group with Wave 2
  - Message: `feat(session): propagate fallback chain in prompt resolution`
  - Files: `packages/opencode/src/session/prompt.ts`

- [ ] 6. Propagar fallback chain en subagent task (`tool/task.ts`)

  **What to do**:
  - En `tool/task.ts:102`, al resolver `model = next.model ?? { ... }`, agregar fallback chain del subagente si existe (`next.fallbackChain`)
  - Si subagente no tiene fallbackChain propia, heredar del mensaje padre (`msg.info.fallbackChain`)
  - Pasar la cadena al `ops.prompt(...)` (línea 134) para que llegue al processor del subagente
  - Determinar orden de precedencia: subagente.fallbackChain → padre.fallbackChain → global.fallback_model

  **Must NOT do**:
  - NO crear nuevos tipos innecesarios; reusar `ModelRef[]` o `Array<{ providerID, modelID }>`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 4 y 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 3

  **References**:
  - `packages/opencode/src/tool/task.ts:102` — Subagent model resolution
  - `packages/opencode/src/tool/task.ts:134` — ops.prompt call

  **Acceptance Criteria**:
  - [ ] Subagente con fallback propio usa el suyo
  - [ ] Subagente sin fallback hereda del padre

  **QA Scenarios**:
  ```
  Scenario: Subagente hereda fallback del padre
    Tool: Bun REPL
    Steps:
      1. Mensaje padre tiene fallbackChain ["a/1", "b/2"]
      2. Subagente no tiene fallback propio
      3. Ejecutar task → verificar que ops.prompt recibe la cadena del padre
    Expected Result: Herencia correcta
    Evidence: .sisyphus/evidence/task-6-subagent-inherit.md

  Scenario: Subagente overridea fallback
    Tool: Bun REPL
    Steps:
      1. Padre tiene fallbackChain ["a/1", "b/2"]
      2. Subagente tiene fallbackChain ["c/3"]
      3. Ejecutar task → verificar que usa cadena del subagente
    Expected Result: Override funciona
    Evidence: .sisyphus/evidence/task-6-subagent-override.md
  ```

  **Commit**: group with Wave 2
  - Message: `feat(tool): propagate fallback chain in subagent tasks`
  - Files: `packages/opencode/src/tool/task.ts`

- [ ] 7. Implementar loop de fallback en processor (`session/processor.ts`)

  **What to do**:
  - En `processor.ts`, reemplazar el pipe actual:
    ```ts
    Effect.retry(SessionRetry.policy({...}))
    Effect.catch(halt),
    ```
    por un loop que:
    1. Intenta stream con modelo actual + retry normal
    2. Si falla con error retryable del modelo (se agota retry) Y existe fallback chain → switch al siguiente modelo y reintentar
    3. Si se agota la cadena completa, hacer `halt`
  - Determinar si hay que clasificar el error post-retry para saber si vale la pena intentar fallback (context_overflow es fatal → no hacer fallback; rate_limit, 5xx, model_not_found → sí intentar)
  - Usar un `Effect.gen` wrapper en `process` que itere sobre la cadena de modelos
  - La cadena se recibe via `streamInput.model` (o campo adicional en `streamInput` a definir)

  **Must NOT do**:
  - NO modificar `retry.ts` — reutilizar `SessionRetry.policy` para cada modelo
  - NO alterar el comportamiento si no hay fallback chain
  - NO acumular mensajes parciales/erróneos de modelos fallidos

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (secuencial: Task 7 pide cambios a processor; mejor hacerlo solo)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 8, 11
  - **Blocked By**: Task 4, 5, 6

  **References**:
  - `packages/opencode/src/session/processor.ts:548` — `llm.stream(streamInput)`
  - `packages/opencode/src/session/processor.ts:568-578` — `Effect.retry` + `Effect.catch(halt)`
  - `packages/opencode/src/session/retry.ts` — `retryable()` para clasificar errores

  **Acceptance Criteria**:
  - [ ] Si modelo falla post-retry y hay fallback → intenta siguiente modelo
  - [ ] Si cadena se agota → halt con error
  - [ ] Si no hay cadena → comportamiento anterior (error directo)

  **QA Scenarios**:
  ```
  Scenario: Fallback exitoso a segundo modelo
    Tool: Bun test con mock de provider
    Preconditions: Mock modelo "a/1" siempre falla; modelo "b/2" siempre responde OK
    Steps:
      1. Crear processor con cadena ["a/1", "b/2"]
      2. Ejecutar process
      3. Verificar que "a/1" fue intentado y falló; luego "b/2" respondió
      4. Verificar que el mensaje final es del modelo "b/2"
    Expected Result: Fallback funciona; mensaje exitoso
    Evidence: .sisyphus/evidence/task-7-fallback-success.md

  Scenario: Cadena agotada sin éxito
    Tool: Bun test
    Preconditions: Todos los modelos fallan
    Steps:
      1. Ejecutar process con cadena ["a/1", "b/2"]
      2. Verificar que ambos fueron intentados
      3. Verificar que halt se llamó con error
    Expected Result: Error final después de agotar cadena
    Evidence: .sisyphus/evidence/task-7-fallback-exhausted.md
  ```

  **Commit**: group with Wave 3
  - Message: `feat(session): implement model fallback loop in processor`
  - Files: `packages/opencode/src/session/processor.ts`

- [ ] 8. Clasificar errores para model-fallback vs fatal

  **What to do**:
  - Extender función `retryable` en `retry.ts` (o crear clasificador en `processor.ts`) para distinguir:
    - errores que indican "problema del modelo" (rate limit del modelo, modelo no disponible/overloaded, 404 de modelo) → HACER fallback
    - errores que indican "problema del usuario/sistema" (context overflow, quota exceeded, prompt inválido) → NO HACER fallback (ir directo a halt)
  - Esta lógica es necesaria para que el processor decida si intentar fallback o no
  - Actual: `ContextOverflowError` ya retorna `undefined` en `retryable` → correcto (no retryable ni fallback)
  - Actual: `FreeUsageLimitError` retorna mensaje, no undefined → revisar si debe ser fatal
  - Necesario: un nuevo tipo de error o discriminant en APIError que diga `isModelRecoverable`?
  - Alternativa: en processor, capturar el error post-retry y hacer match sobre el message/code

  **Must NOT do**:
  - NO modificar la API pública de `SessionRetry` si no es necesario
  - NO reescribir toda la clasificación de errores (solo añadir criterio para fallback)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 7, aunque depende de la clasificación para integrar)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 11
  - **Blocked By**: Task 4

  **References**:
  - `packages/opencode/src/session/retry.ts` — `retryable()` function
  - `packages/opencode/src/provider/error.ts` — Error parsing
  - `packages/opencode/src/session/processor.ts:568` — donde se consume retry

  **Acceptance Criteria**:
  - [ ] errores de rate-limit, model-unavailable, 5xx → fallback candidatos
  - [ ] context-overflow, invalid-prompt, insufficient-quota → fallback NO candidatos (fatal)

  **QA Scenarios**:
  ```
  Scenario: Rate limit → fallback candidato
    Tool: Bun test
    Steps:
      1. Crear APIError simulado con mensaje "rate limit exceeded"
      2. Llamar retryable(error)
      3. Assert retorna string (es retryable)
      4. Llamar isFallbackCandidate(error)
      5. Assert retorna true
    Expected Result: Es candidato a fallback
    Evidence: .sisyphus/evidence/task-8-classify-rate.md

  Scenario: Context overflow → no fallback
    Tool: Bun test
    Steps:
      1. Crear ContextOverflowError
      2. Llamar retryable(error)
      3. Assert retorna undefined (no retryable)
      4. Llamar isFallbackCandidate(error)
      5. Assert retorna false
    Expected Result: No es candidato a fallback
    Evidence: .sisyphus/evidence/task-8-classify-fatal.md
  ```

  **Commit**: group with Wave 3
  - Message: `feat(session): classify errors for model fallback eligibility`
  - Files: `packages/opencode/src/session/retry.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/src/provider/error.ts`

- [ ] 9. Tests de config parsing (config/agent + config/config)

  **What to do**:
  - Agregar tests en `test/config/config.test.ts` para `fallback_model` en config global:
    - Parseo válido
    - Merge correcto
    - Ignora si undefined
  - Agregar tests en `test/config/agent.test.ts` (o crearlo si no existe) para `AgentSchema.fallback_model`:
    - Parseo válido de array de strings
    - Validación de formato ConfigModelID
    - Que no caiga en `options` cuando está en `KNOWN_KEYS`

  **Must NOT do**:
  - NO modificar tests existentes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 10 y 11)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task F2 (si tests fallan)
  - **Blocked By**: Task 1, 2

  **References**:
  - `packages/opencode/test/config/config.test.ts` — Tests existentes de merge

  **Acceptance Criteria**:
  - [ ] Tests de parsing `fallback_model` pass
  - [ ] Tests de merge config pass
  - [ ] `bun test` desde `packages/opencode/` → all pass

  **QA Scenarios**:
  ```
  Scenario: Test suite completa de config
    Tool: bash → `bun test`
    Steps:
      1. Correr `bun test test/config/config.test.ts`
      2. Correr `bun test test/config/agent.test.ts` (o donde se pongan)
      3. Verificar que tests nuevos y existentes pasan
    Expected Result: 0 failures
    Evidence: .sisyphus/evidence/task-9-config-tests.md
  ```

  **Commit**: group with Wave 4
  - Message: `test(config): add fallback_model parsing tests`
  - Files: `packages/opencode/test/config/ (archivos de test)`

- [ ] 10. Tests de resolución de fallback (agent + prompt + tool/task)

  **What to do**:
  - Testear que `Agent.Service` carga y mergea `fallbackChain` correctamente
  - Testear que `session/prompt.ts` propaga la cadena al `PromptInput`
  - Testear que `tool/task.ts` hereda/overridea la cadena correctamente
  - Usar mocks para provider y config

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 9 y 11)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task F3
  - **Blocked By**: Task 3, 5, 6

  **References**:
  - `packages/opencode/test/agent/` — tests de agentes
  - `packages/opencode/test/tool/` — tests de herramientas

  **Acceptance Criteria**:
  - [ ] Agent merge test pass
  - [ ] Prompt propagation test pass
  - [ ] Task inheritance/override test pass

  **QA Scenarios**:
  ```
  Scenario: End-to-end de resolución
    Tool: bun test
    Steps:
      1. Mock config, agent, provider
      2. Ejecutar cadena completa: agent → prompt → task
      3. Assert cadena resultante es la esperada en cada nivel
    Expected Result: Todos los pasos pass
    Evidence: .sisyphus/evidence/task-10-resolution-tests.md
  ```

  **Commit**: group with Wave 4
  - Message: `test(agent): add fallback chain resolution tests`
  - Files: `packages/opencode/test/agent/`, `packages/opencode/test/session/`, `packages/opencode/test/tool/`

- [ ] 11. Tests de integración en processor (simulación de fallo + fallback)

  **What to do**:
  - Crear tests de integración más pesados en `test/session/processor.test.ts` (o crear)
  - Usar `Effect` para construir un stream simulado que falle una cantidad determinada de veces
  - Validar que el processor itere la cadena correctamente
  - E2E: que un mensaje que llega con fallback chain termina generando respuesta del modelo exitoso (o error si todos fallan)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (con Task 9 y 10)
  - **Parallel Group**: Wave 4
  - **Blocks**: F4
  - **Blocked By**: Task 7, 8

  **References**:
  - `packages/opencode/test/session/` — tests de sesión
  - `packages/opencode/src/session/processor.ts` — a integrar

  **Acceptance Criteria**:
  - [ ] Test de fallback exitoso (modeloA falla → modeloB responde)
  - [ ] Test de cadena agotada (todos fallan → error)
  - [ ] Test sin cadena (fallback inactivo → comportamiento previo)

  **QA Scenarios**:
  ```
  Scenario: Processor E2E fallback
    Tool: bun test
    Steps:
      1. Setup mock: modelo1 falla, modelo2 responde
      2. Ejecutar processor con cadena ["p1/m1", "p2/m2"]
      3. Assert: se intentó modelo1 (con retry), se intentó modelo2, mensaje exitoso
    Expected Result: Mensaje exitoso del modelo2
    Evidence: .sisyphus/evidence/task-11-processor-e2e.md

  Scenario: Processor E2E sin fallback
    Tool: bun test
    Steps:
      1. Setup mock: modelo1 falla, sin cadena de fallback
      2. Ejecutar processor
      3. Assert: se intentó modelo1, se agotó retry, halt con error
    Expected Result: Error halt, no hay cadena, comportamiento anterior
    Evidence: .sisyphus/evidence/task-11-processor-no-fallback.md
  ```

  **Commit**: group with Wave 4
  - Message: `test(session): add model fallback integration tests`
  - Files: `packages/opencode/test/session/processor.test.ts`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun typecheck` from `packages/opencode/` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Ejecutar un test end-to-end: crear agente con fallback_chain, forzar fallo del modelo primario (stub/mock), verificar que ejecute el fallback. Guardar evidencia en `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

Commits agrupados por wave, usando conventional commits:

- **W1**: `feat(config): add fallback_model to agent and global config`
- **W2**: `feat(agent): add fallbackChain resolution and propagation`
- **W3**: `feat(session): implement model fallback loop in processor`
- **W4**: `test(session): add model fallback integration tests`

Pre-commit para cada wave: `bun typecheck` desde `packages/opencode/` + `bun test`

---

## Success Criteria

### Verification Commands
```bash
# Desde packages/opencode/
bun typecheck  # Expected: 0 errors
bun test       # Expected: todos los tests pasan (incluidos los nuevos)
```

### Final Checklist
- [ ] Todos los "Must Have" presentes
- [ ] Todos los "Must NOT Have" ausentes
- [ ] `bun typecheck` pasa
- [ ] `bun test` pasa
- [ ] Commit strategy aplicado
