# feat(core): expose structured truncation counts in shell metadata

Closes #65018

## Resumen
`packages/core/src/shell.ts` ya calculaba `size`, `total`, `kept` e `info.file` pero los descartaba al devolver `{output, truncated}`. Se exponen de forma aditiva (`Schema.optionalKey`) en metadata, `StructuredOutput` y notificaciones: `outputPath`, `totalBytes`, `shownBytes`, `totalLines`, `startLine`, `endLine`. Sin I/O extra, sin dependencias nuevas, sin flag y sin ADR. `outputPath` ya se exponía en HEAD; no hay filtrado nuevo.

## Plan de prueba
Una prueba enfocada en `packages/core/test/tool-shell.test.ts`: verifica los campos nuevos en metadata. Rojo (metadata solo tenía `exit/truncated/status`) → verde. Suite del archivo: 91 pass / 23 skip preexistentes / 0 fail. `bun run check` 36/36.

## Cambios
- `packages/core/src/shell.ts`
- `packages/core/src/shell/result.ts`
- `packages/core/src/tool/plugin/shell.ts`
- `packages/core/test/tool-shell.test.ts`

## Cierre de issues
Closes #65018. Sin cambios en Schema/Protocol/HttpApi (no requiere `bun run generate`). Cuatro aserciones `toEqual` preexistentes se ajustaron por el campo booleano `truncated` ya calculado: exposición aditiva, no regresión.
