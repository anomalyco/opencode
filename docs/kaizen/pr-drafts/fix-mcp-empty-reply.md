# fix(core): handle empty MCP replies without content type

Closes #65473

## Resumen
El fallback de conexión MCP solo cubría errores HTTP 400/404. Cuando el cliente Añade `?codemode=false` y el servidor responde `200` vacío sin `Content-Type`, el SDK reporta `SdkError(ClientHttpUnexpectedContent)` y la conexión falla. Se amplía el fallback con un helper `unusableReply()` que detecta respuestas 200/202/204 sin cuerpo útil y reintenta `negotiate()` sobre la misma URL configurada. La causa real no es el `202` del título: el SDK 2.4.0 ya maneja 202; el problema es el 200 vacío.

## Plan de prueba
Una prueba de regresión enfocada en `packages/core/test/mcp.test.ts`: responde `200` sin `Content-Type` y verifica que la conexión reintenta y termina. Rojo con el código original (`Unexpected content type: null`), verde con el fix. Suite `packages/core`: 115 pass / 0 fail.

## Cambios
- `packages/core/src/mcp/client.ts`
- `packages/core/test/mcp.test.ts`

## Cierre de issues
Closes #65473. Sin cambios en Protocol/HttpApi (no requiere `bun run generate`). Sin bandera: bugfix de orden/detección (AGENTS.md exime a fixes).
