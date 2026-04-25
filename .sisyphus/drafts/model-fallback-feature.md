# Draft: Model Fallback Feature

## Investigación Previa (Completada)
- PR #18140: Fallback de system prompt para agentes
- PR #4653: Fallback de modelo en provider.ts (gpt-5-nano)
- NO existe fallback unificado entre modelos para agentes/subagentes
- Retry logic existe pero SIN switch automático de modelo
- Puntos de entrada identificados:
  - packages/opencode/src/agent/agent.ts
  - packages/opencode/src/tool/task.ts
  - packages/opencode/src/provider/provider.ts
  - packages/opencode/src/config/agent.ts

## Requisitos a Clarificar (Pendiente)
- [ ] ¿Herencia de config fallback (padre → hijo) o config independiente?
- [ ] ¿Cadena de fallbacks o solo 1 alternativa?
- [ ] ¿Qué trigger el fallback? (rate limit, error 5xx, timeout, cualquier fallo?)
- [ ] ¿Persistencia de estado entre sesiones?

## Scope Tentativo
- INCLUDE: Configuración de fallback en nivel agente y subagente
- INCLUDE: Lógica de fallback entre modelos con criteria definidos
- EXCLUDE: Cambios a retry existente (reuse/adapt)
- EXCLUDE: UI para configurar (solo config por archivo/CLI inicialmente)
