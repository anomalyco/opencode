# OpenCode Fork — MethodWhite

Fork de [opencode](https://github.com/anomalyco/opencode) con **hardening del worker
llama.cpp local**, modos **compose + auto**, y fixes de harness (caché, observabilidad).

> ⚠️ **Fork personal** — no afiliado al equipo de opencode. Basado en el upstream
> (rama `dev`), con modificaciones propias en la rama `llama-worker-hardening`.

---

## Qué añade este fork

### 1. Worker llama.cpp endurecido (local, sin cloud)

Gestión del ciclo de vida del worker `llama-server` por modelo GGUF:

- Modelos locales registrados: `Qwen3.5-9B-Abliterated`, `gemma-4-E4B-it-OBLITERATED`, `qwen2.5-3b`.
- `--fit` / `--fit-target` (auto-ajuste del offload a la VRAM disponible).
- KV cache cuantizado (`--cache-type-k/v q8_0`) → ~mitad de memoria KV.
- `--flash-attn`, `-ngl` por modelo, `-np` slots, `-t` threads.
- Serialización del spawn + reemplazo saludable de workers; `contextLength` cae a
  `model.limit.context` cuando no se define.

### 2. Modos **compose** y **auto** (+ tool `switch_mode`)

- **Compose**: edición + terminal completos con prompt de workflow (como plan, con permisos de build).
- **Auto**: cambia entre plan/compose/build **sin preguntar** (como Cursor), vía la tool `switch_mode`.
- La TUI escucha `switch_mode` y actualiza el agente activo.

### 3. Fix de harness

- **Caché**: `ai-sdk.ts` ahora registra `cacheCreationInputTokens` como fallback de
  `cacheWriteInputTokens` (antes el cache write quedaba en 0 para providers que usan el campo estándar del AI SDK).
- **Observabilidad**: redacción de secretos en logging (`core/observability/redact.ts`).

---

## Build y uso

```bash
bun install
bun run build          # compila el binario (fork)
bun dev                # TUI en modo desarrollo (desde packages/opencode)
```

Config del provider llama.cpp (ejemplo en `.opencode/opencode.jsonc`):

```jsonc
{
  "provider": {
    "llamacpp": {
      "options": { "url": "http://127.0.0.1:8080/v1" },
      "models": {
        "Qwen3.5-9B-Abliterated.Q4_K_M.gguf": {
          "name": "Qwen 3.5 9B Abliterated (local)",
          "modelPath": "/ruta/al/modelo.gguf",
          "fit": true,
          "fitTargetMiB": 512,
          "flashAttention": true
        }
      }
    }
  }
}
```

Agentes: ciclar con `Tab` hasta `compose` o `auto`; o `default_agent: "auto"` en config.

---

## Proyectos relacionados

- **HSAQ** (HyperSparse Adaptive Quantization): https://huggingface.co/MethodWhite/HSAQ
- **Modelo abliterado con HSAQ**: https://huggingface.co/MethodWhite/Qwen3.5-9B-Abliterated-HSAQ
- **MATERIA** (arquitectura/optimizador): https://github.com/MethodWhite/materia-core

---

## NEWS — Mejoras del fork (v1.18.14-fork)

### 🔧 Worker llama.cpp (local)
- Gestión del ciclo de vida de `llama-server` por modelo GGUF.
- `--fit` / `--fit-target`: auto-ajuste del offload a la VRAM disponible.
- KV cache cuantizado (`--cache-type-k/v q8_0`) → ~mitad de memoria KV.
- `--flash-attn`, `-ngl` por modelo, `-np` slots, `-t` threads.
- Spawn serializado + reemplazo saludable de workers.
- `contextLength` cae a `model.limit.context` cuando no se define.

### 🤖 Modos de agente
- **compose**: edición + terminal con workflow de diseño previo.
- **auto**: decide plan/compose/build sin preguntar, y **vuelve a Auto** tras cada sub-modo (flujo completo sin quedarse fijo).
- **yolo** (nuevo): ejecución autónoma con todo permitido, sin confirmaciones ni gates de planificación; delega y retorna a yolo.

### 🐛 Fixes de harness
- **Caché**: `ai-sdk.ts` ahora registra `cacheCreationInputTokens` como fallback de `cacheWriteInputTokens` (antes el cache write quedaba en 0 para providers con el campo estándar del AI SDK).
- **Stats/budget**: `opencode stats --models` ya **excluye la caché del promedio de tokens/sesión** (antes el cache read de miles de millones inflaba el "Avg Tokens/Session"); la caché se reporta por separado.
- **Observabilidad**: redacción de secretos en logging (`core/observability/redact.ts`).
- **Build**: `compile.files` tipado para bun 1.3.14 (verificado en runtime).

### ✅ Todo mejorado
- Tool `todowrite` con **ops granulares** (`add` / `complete` / `remove` por contenido) — sin reescribir toda la lista.
- TUI: header de progreso (`✓ n/total · m en curso`), prioridades (high `!`, medium `·`) y colores por estado (completado ✓ verde, en curso • amarillo).

### 🛡️ Seguridad de repo
- Rama `dev` (default) protegida: requiere 1 review, sin force-push, sin borrado.

---

## Créditos

Fork por **Jesús Antonio Zárate Hernández** (@MethodWhite) · Inspirado en
[opencode](https://github.com/anomalyco/opencode) (upstream).

Si te sirve, invítame un café ☕ → **https://buymeacoffee.com/methodwhite**
