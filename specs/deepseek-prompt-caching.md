# DeepSeek: ajuste vertical y prompt caching

Estado: parcialmente implementado (2026-10-06).

## Contexto

DeepSeek usa el proveedor genérico OpenAI-compatible
(`packages/llm/src/providers/openai-compatible-profile.ts`, base
`https://api.deepseek.com/v1`) sobre el protocolo `openai-chat`. Su caché de
prefijo es automático y exacto byte a byte: no requiere marcadores
`cache_control`.

## Hallazgos

1. **Usage de caché no mapeado.** DeepSeek informa `prompt_cache_hit_tokens` y
   `prompt_cache_miss_tokens` en la raíz de `usage`. `mapUsage` solo leía
   `prompt_tokens_details.cached_tokens` (formato OpenAI), por lo que
   `cacheReadInputTokens` quedaba vacío con DeepSeek.
2. **Prefijo inestable.** `packages/opencode/src/session/system.ts` (bloque
   `<env>`) incluye `Today's date` dentro del prompt de sistema. Si cambia el
   prefijo, se pierde el acierto de caché.
3. **Sin prompt específico.** `SystemPrompt.provider` no tiene rama para
   DeepSeek; usa `PROMPT_DEFAULT`.
4. **Sin hints de caché para `openai-chat`.** `packages/llm/src/cache-policy.ts`
   (`RESPECTS_INLINE_HINTS`) solo cubre `anthropic-messages` y
   `bedrock-converse`. Es correcto para DeepSeek, cuyo caché es automático.
5. **Orden de ensamblado.** `packages/opencode/src/session/llm/request.ts`
   une prompt de proveedor, `input.system` y el sistema del usuario en un solo
   mensaje; las tools se ordenan alfabéticamente (estable, favorable al caché).

## Cambios realizados

- `packages/llm/src/protocols/openai-chat.ts`: el schema acepta
  `prompt_cache_hit_tokens` y `prompt_cache_miss_tokens`; `mapUsage` los usa
  como `cacheReadInputTokens` y `nonCachedInputTokens` cuando no existe el
  formato OpenAI.
- `packages/llm/test/provider/openai-chat.test.ts`: test
  "maps DeepSeek prompt_cache_hit/miss_tokens to cache usage".
- Verificación: `bun test test/provider/openai-chat.test.ts
  test/provider/openai-compatible-chat.test.ts` (33 OK) y `bun typecheck` en
  `packages/llm`.

## Tareas pendientes

- [ ] Crear `packages/opencode/src/session/prompt/deepseek.txt` y su rama en
  `SystemPrompt.provider` (detectar `deepseek` en `model.api.id` o
  `providerID`); añadir test en `packages/opencode/test/session/system.test.ts`.
- [ ] Estabilizar el prefijo: mover `Today's date` y otros datos volátiles al
  final del contexto o a un mensaje aparte. Validar que no rompa otros
  proveedores.
- [ ] Medir la tasa de aciertos de caché en una sesión real con DeepSeek
  (`cacheReadInputTokens / inputTokens`) antes y después.
- [ ] Revisar costos por modelo DeepSeek para que usen el precio de lectura de
  caché.
