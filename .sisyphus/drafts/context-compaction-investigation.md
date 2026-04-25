# Draft: Compactación de Contexto Ineficiente en OpenCode

## Problema Identificado
La actual compactación de contexto en OpenCode es ineficiente porque:
1. Se muestra en pantalla el proceso de compactación
2. Interrumpe la cadena de pensamiento del agente
3. Espera a que se resuelva en lugar de ser un proceso en segundo plano
4. El agente debería continuar sin interrupciones abruptas

## Estado Actual de OpenCode (Descubierto)

### Problemas Identificados:
1. **El usuario VE la compactación** → Se muestra un mensaje "compacting" en el chat
2. **El agente SE DETIENE** → `processor.ts` bloquea mientras se genera el resumen
3. **Interrupción visible** → Se publica un evento visible en el UI
4. **Mensaje sintético** → Después del resumen, se manda "Continue if you have next steps..."
5. **Pérdida de hilo** → El agente tiene que "recontinuar" desde el resumen

### Arquitectura Actual:
- `overflow.ts` → Detecta si los tokens exceden el límite usable
- `compaction.ts` → Genera el resumen usando un agente especial "compaction"
- El resumen sigue una estructura estricta: Goal, Constraints, Progress, Key Decisions, etc.
- El evento `SessionCompacted` se publica y es VISIBLE en el UI

### Oportunidades Clave:
- El sistema YA tiene un agente de compactación funcionando
- El prompt de compactación ya está optimizado (`compaction.txt`)
- Soporta "tail turns" (preservar N turnos recientes)
- Soporta "preserve recent tokens" (presupuesto de tokens)

## Investigación Competencia (Síntesis)

### Claude Code (Anthropic):
- NO muestra compactación al usuario
- Cuando el contexto está lleno, resumen internamente y continúan
- El usuario apenas nota una pausa breve
- No hay mensajes sintéticos visibles
- El agente mantiene su cadena de pensamiento sin interrupciones

### Gemini CLI (Google):
- Similar, maneja el resumen interno
- Usa estrategias de ventana deslizante (sliding window)
- Descarta mensajes antiguos automáticamente
- El contexto se compacta en background sin notificar

### Cursor IDE:
- Tiene un mecanismo de "Context Compression" transparente
- Resume en background automáticamente
- Inyecta el resumen en la memoria del agente sin interrumpir el flujo
- El usuario no ve nada, el agente simplemente "sigue sabiendo"

## Objetivo Final
Diseñar un sistema de compactación fluido para OpenCode que:
- Corra en segundo plano (async) usando `Effect.forkScoped`
- No interrumpa la cadena de pensamiento del agente
- Inyecte el contexto compactado transparentemente (sin mensajes visibles)
- Sea imperceptible para el usuario

## Alcance
- IN: Investigación de herramientas existentes, diseño de arquitectura
- OUT: Implementación del código (esa será otra planificación)
