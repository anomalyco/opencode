# Arquitectura de Optimizaciones Locales, Hallazgos y Hoja de Ruta

Este documento consolida los fundamentos arquitectónicos, mediciones cuantitativas empíricas y el backlog de tareas pendientes de las **14 optimizaciones de hardware local** integradas en la rama `local-prod` del fork [opencode](https://github.com/datamaq-automation/opencode).

---

## 1. Principio Rector: Carga Pesada en Hardware Local ($0 Tokens)

La arquitectura de este fork implementa el principio de que la máquina local (CPU multi-hilo, NVMe, iGPU Vulkan, SQLite en WAL y Ollama) absorbe el pre-procesamiento y post-procesamiento determinista para enviar y recibir la **mínima cantidad de tokens ultra-precisos** a los modelos remotos.

```
Hardware Local (CPU/RAM/iGPU/NVMe)                  Modelos Remotos (DeepSeek/Gemini/Claude)
┌──────────────────────────────────────────────┐    ┌────────────────────────────────────────┐
│ - Poda de terminal (TerminalPruner)          │    │                                        │
│ - Validación sintáctica AST (SyntaxValidator)│───►│ Contexto Compacto y Determinado        │
│ - Caché vectorial SQLite WAL (58 µs)         │    │ (Ahorro sistemático > 65% - 97%)       │
│ - Compactación histórica de sesión (KV safe) │    │                                        │
│ - Búsqueda híbrida RRF dense + léxica        │◄───┤ Diffs quirúrgicos y desambiguados      │
│ - Desambiguación de parches (Surgical Patch) │    │ (Zero fallos por whitespace o matches) │
│ - AST Skeletonizer V2 (view: skeleton)       │    └────────────────────────────────────────┘
└──────────────────────────────────────────────┘
```

---

## 2. Catálogo de Optimizaciones Implementadas y Métricas

Todas las optimizaciones fueron diseñadas bajo Clean Architecture, tipado estricto con Effect/Schema, verificación TDD y validación DIP con `plan_dip_auditor.py`.

| # | Componente / Herramienta | Módulo Principal | Métrica y Hallazgo Empírico ($0 Tokens) |
| :--- | :--- | :--- | :--- |
| **1** | **TerminalPruner (Bash Tool)** | ↗ [packages/core/src/tool/terminal-pruner.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/tool/terminal-pruner.ts) | Poda salidas ruidosas de compilación y suites de tests. Ahorro de **96.7%** en tests (10,259 a 336 tokens) y **81.9%** en builds en **2.49 ms**. |
| **2** | **TerminalPruner (Shell Tool)** | ↗ [packages/opencode/src/tool/shell.ts](file:///home/agustin/proyectos_software/opencode/packages/opencode/src/tool/shell.ts) | Intercepta ejecuciones interactivas de comandos shell con persistencia íntegra del log en disco (`.opencode/logs/`). |
| **3** | **SyntaxValidator AST** | ↗ [packages/core/src/tool/syntax-validator.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/tool/syntax-validator.ts) | Valida código TypeScript/Python antes de persistir la edición. Intercepta errores sintácticos en **2.6 ms** en TS y **17.4 ms** en Python, ahorrando 1,000-2,500 tokens remotos por reintento evitado. |
| **4** | **Prompt Caching Optimizer** | ↗ [packages/core/src/session/runner/index.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/session/runner/index.ts) | Preserva el orden canónico de materialización de herramientas y elimina bloques de razonamiento efímero para mantener el prefijo KV Cache determinista. |
| **5** | **Bound Search Limits** | ↗ [packages/opencode/src/tool/grep.ts](file:///home/agustin/proyectos_software/opencode/packages/opencode/src/tool/grep.ts) | Acota a 100 resultados las búsquedas de `grep` y `glob` con aviso transparente de truncamiento, evitando desbordes accidentales de contexto. |
| **6** | **Local Semantic Embedder** | ↗ [packages/core/src/semantic/embedder.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/semantic/embedder.ts) | Generador de embeddings para Ollama (`nomic-embed-text`) con similitud coseno en RAM a **329,507 comparaciones/seg**. Fallback determinista en ausencia del daemon. |
| **7** | **SemanticCache SQLite** | ↗ [packages/core/src/semantic/cache.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/semantic/cache.ts) | Almacén de vectores BLOB `Float32Array` en `bun:sqlite` con modo WAL. Recuperación puntual en **58 µs** (**6,059x más veloz** que re-inferir en CPU local). |
| **8** | **CLI Semantic Search** | ↗ [packages/opencode/src/tool/semantic-search.ts](file:///home/agustin/proyectos_software/opencode/packages/opencode/src/tool/semantic-search.ts) | Exposición de la herramienta `semantic_search` en la CLI interactiva con política `always: ["*"]` (auto-aprobada para evitar fricción interactiva). |
| **9** | **Context Compaction** | ↗ [packages/core/src/session/runner/to-llm-message.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/session/runner/to-llm-message.ts) | Ventana deslizante de recencia (2 turnos). Reduce un **65.2%** de los tokens acumulados en turno 5 (11,999 tokens ahorrados) con latencia de proyección de **3.16 ms**. |
| **10** | **Compaction Overflow Guard** | ↗ [packages/core/src/session/runner/llm.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/session/runner/llm.ts) | Resuelve Issue #51346: previene bucles infinitos de compactación ante adjuntos sobredimensionados; corta limpiamente con error `context-overflow`. |
| **11** | **Semantic Indexer SHA-256** | ↗ [packages/core/src/semantic/indexer.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/semantic/indexer.ts) | Pre-indexación incremental con deduplicación content-addressable (`sha256(text)`). Pasa de 53 ms (cold) a **14.39 ms** (warm) con **100% cache hits** ($0 tokens). |
| **12** | **Reactive Semantic Watcher** | ↗ [packages/core/src/semantic/indexer.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/semantic/indexer.ts) | Watcher de sistema de archivos (`@parcel/watcher` con fallback a `fs.watch`) con debounce de 1,500 ms y comandos `opencode semantic watch` y `--watch`. |
| **13** | **Hybrid Search RRF** | ↗ [packages/core/src/semantic/rrf.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/semantic/rrf.ts) | Reciprocal Rank Fusion ($k=60$) que fusiona vectores densos con tokenización léxica en **5.72 ms**, elevando el identificador exacto y ahorrando **97.5% de tokens**. |
| **14** | **Surgical Patch Optimizer** | ↗ [packages/core/src/tool/patch-optimizer.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/tool/patch-optimizer.ts) | Desambiguación de parches con múltiples ocurrencias (324 µs) y sanación difusa de whitespace (133 µs). Ahorra 1 turno completo y **97.8%** de tokens en reintentos. |
| **15** | **AST Skeletonizer (Read Tool V2)** | ↗ [packages/core/src/skeleton/index.ts](file:///home/agustin/proyectos_software/opencode/packages/core/src/skeleton/index.ts) | Extracción de interfaces, tipos y firmas con `view: "skeleton"`. Ahorro de **52.4% - 54.9%** de tokens de entrada en **748 µs** (Python) y **27 ms** (TypeScript). |

---

## 3. Certezas Técnicas y de Entorno de Ejecución

1. **Ejecución Directa sin Compilación:**
   El ejecutable ↗ [/home/agustin/.local/bin/opencode](file:///home/agustin/.local/bin/opencode) delega directamente en:
   ```bash
   exec bun run --cwd /home/agustin/proyectos_software/opencode/packages/opencode src/index.ts "$@"
   ```
   Toda modificación testeada e integrada en `local-prod` queda inmediatamente activa para el usuario en su terminal diaria.
2. **Suite Forense de Benchmarking:**
   La suite completa se ejecuta con `bun run bench:optimizations` en `packages/opencode`, validando cuantitativamente los 8 benchmarks en menos de 4 segundos sobre la CPU local.
3. **Inversión de Dependencias (DIP):**
   La arquitectura respeta estrictamente `Schema -> Core -> Server/Protocol -> Client/CLI`. Los módulos semánticos e indexadores dependen de contratos de servicio abstractos.

---

## 4. Backlog de Tareas Pendientes

### A. Tareas Técnicas Locales

- [x] **Skeleton Automático por Umbral:**
  - *Objetivo:* En `ReadToolFileSystem`, cuando `page.view` no esté especificado pero el archivo a leer supere las 800 líneas y no se haya provisto `offset`/`limit`, activar automáticamente `view: "skeleton"`.
  - *Beneficio:* Evita que un modelo sature involuntariamente su ventana de contexto volcando archivos gigantescos en lecturas exploratorias. Implementado y testeado con TDD (`tool-read-skeleton.test.ts`).
- [ ] **Token Telemetry en Core V2:**
  - *Objetivo:* Integrar en los metadatos de eventos de herramientas de Core V2 (`tool-output-store.ts` / `runner`) los contadores de `rawBytes`, `prunedBytes`, `rawTokens` y `tokensSaved`.
  - *Beneficio:* Visibilidad forense directa en la TUI de los tokens ahorrados por cada invocación.
- [ ] **LRU Cache en RAM para Embeddings de Alto Tráfico:**
  - *Objetivo:* Colocar una pequeña caché LRU de 256 elementos frente a `SemanticCache` de SQLite para responder a consultas repetidas en sub-microsegundos (< 1 µs).

### B. Tareas Upstream (`anomalyco/opencode`)

- [ ] **Monitoreo Continuo de PRs Semilla (VPS):**
  - PR ↗ [#53168](https://github.com/anomalyco/opencode/pull/53168): `feat(skeleton): add AST skeletonizer service and view parameter in read tool`.
  - PR ↗ [#53169](https://github.com/anomalyco/opencode/pull/53169): `feat(telemetry): add payload size and token estimation to tool outputs`.
  - El bot en `/opt/pr-monitor/pr_monitor.py` notifica inmediatamente a Telegram cualquier comentario o cambio de estado.
- [ ] **Apertura de Lotes Posteriores (Bajo Demanda):**
  - **Lote 1:** `bound-search-limits`, `local-syntax-validation`, `prune-shell-output`.
  - **Lote 2:** `optimize-prompt-caching`, `compact-session-history`.
  - **Lote 3:** `semantic-cache-sqlite`, `cli-semantic-search`, `watch-semantic-index`, `hybrid-semantic-search`.
  - **Lote 4:** `bench-token-savings`.
