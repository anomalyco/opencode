# Plan: Eliminar Error de Compactación "Tool call not allowed while generating summary"

## TL;DR

Eliminar los `throw new Error(...)` en `processor.ts` que rompen la compactación cuando el LLM emite eventos de tool-call durante el summary. Reemplazar por log + skip silencioso.

## Contexto

### Síntoma
Durante la compactación de sesión (cuando el contexto excede el límite de tokens), el flujo se rompe con:
```
Tool call not allowed while generating summary: bash
Tool call not allowed while generating summary: write
```

### Causa Raíz
En `packages/opencode/src/session/processor.ts` (líneas 261 y 289), hay dos checks hard que lanzan `Error` cuando el LLM emite eventos de tool-call durante un mensaje de asistente marcado como `summary: true`:
```ts
if (ctx.assistantMessage.summary) {
  throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
}
```

### Por Qué Ocurre
Durante compactación:
- Se crea un mensaje de asistente con `summary: true`
- Se llama a `processor.process({ tools: {}, ... })` — SIN herramientas
- PERO algunos LLMs/ proveedores emiten eventos de tool-call genéricos (ej. `tool-input-start`, `tool-call`) aunque no haya herramientas definidas
- El processor detecta `ctx.assistantMessage.summary && tool-call event` → **throw Error** → compactación falla

El agente `compaction` tiene **todos los permisos denegados** (`"*": "deny"`) y el prompt NO instruye usar herramientas. El error es una defensa excesiva.

## Estrategia de Eliminación

### Cambio Principal: processor.ts
Reemplazar los `throw new Error(...)` por `slog.warn(...)` + `return/continue`.

**Ubicaciones:**
1. Línea 260-262 (`case "tool-input-start":`)
2. Línea 288-290 (`case "tool-call":`)

**Nuevo comportamiento:**
- Si `ctx.assistantMessage.summary` es `true`, loggear warning y **skip** el evento
- No abortar la compactación
- No propagar error

### Cambio Secundario: Test de Compatibilidad
Actualizar el test en `test/session/compaction.test.ts`:
```ts
test("does not allow tool calls while generating the summary", ...)
```
Cambiar la aserción de error → aserción de que el evento fue ignorado.

## Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Modelo real intente usar herramientas en summary | El `Permission.merge` ya deniega todo para agente compaction |
| Fuga de tool calls silenciosas | Solo afecta agentes `summary: true`, que son compaction/summary — ambos con deny all |
| Tests fallan | Actualizar test mencionado arriba |

## Tareas
1. [ ] Editar `packages/opencode/src/session/processor.ts` — reemplazar throws por log+skip (líneas 260-262, 288-290)
2. [ ] Editar `packages/opencode/test/session/compaction.test.ts` — actualizar test para reflejar nuevo comportamiento
3. [ ] Typecheck + tests para validar
4. [ ] Commit + push

## Archivos a Modificar
- `packages/opencode/src/session/processor.ts` (2 lugares)
- `packages/opencode/test/session/compaction.test.ts` (1 test)

## QA
- La compactación debe completarse sin lanzar error cuando el LLM emite tool-call-like events
- El log debe mostrar: `[session.processor] summary tool call skipped: <toolName>`
