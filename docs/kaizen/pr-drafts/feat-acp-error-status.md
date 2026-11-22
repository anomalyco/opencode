# feat(cli): expose provider status and retry delay in ACP errors

Closes #65520

## Resumen
Los errores de terminal vía ACP omitían el `status` del proveedor y el `retryAfterMs`, aunque el dato existe en `SessionError.Error`. Se amplía `executionError` a `SessionError.Error`, se propagan `status`/`retryAfterMs` al `data` del JSON-RPC y se añaden como campos opcionales validados en `ServiceFailureError`. No se exponen `response.body` ni trazas.

## Plan de prueba
Una prueba enfocada en `packages/cli/test/acp/error.test.ts` cubriendo `execution.failed`, `step.failed` y un control negativo. Rojo: `data` sin `status: 429`/`retryAfterMs: 60000`. Verde: 4/4; `--rerun-each 3` 12/12; suite ACP 115/0.

## Cambios
- `packages/cli/src/acp/error.ts`
- `packages/cli/src/acp/translate.ts`
- `packages/cli/test/acp/error.test.ts`

## Cierre de issues
Closes #65520. Sin cambios en Protocol/HttpApi (no requiere `bun run generate`). Tipado feature (según etiqueta `type/feature` del issue).
