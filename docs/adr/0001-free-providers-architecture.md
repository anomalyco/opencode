# ADR 0001: Standard for OpenAI-Compatible Free Provider Extensions

* **Status:** Accepted
* **Deciders:** CTO Orchestrator, Software Architect, Backend Engineer
* **Date:** 2026-07-23
* **Framework:** AI SDLC Operating System v1.1 (Phase 5)

---

## Context & Problem Statement

OpenCode requires native support for emerging free and open-access LLM APIs (such as `llm7.io` and `Aion Labs`). The provider architecture must allow registering OpenAI-compatible base URLs without introducing breaking changes to existing provider plugins or violating Monorepo dependency layers (`packages/schema` -> `packages/core` / `packages/protocol` -> `packages/server`).

---

## Decision Drivers

1. **Extensibility:** Simple, declarative profile definitions for OpenAI-compatible providers (`packages/llm/src/providers/openai-compatible-profile.ts`).
2. **Catalog Transformation:** Automatic injection of gateway-required identification headers (`HTTP-Referer`, `X-Title`) via Effect catalog hooks.
3. **Decoupling:** Provider plugins must remain in `packages/core/src/plugin/provider/` and self-register in `ProviderPlugins`.

---

## Technical Design & Architecture

```
[packages/llm]
   └── openai-compatible-profile.ts  <-- Base URL & Profile Registry
          │
[packages/core]
   ├── src/plugin/provider/llm7.ts    <-- Declarative Plugin Header Injection
   ├── src/plugin/provider/aionlabs.ts <-- Declarative Plugin Header Injection
   └── src/plugin/provider.ts         <-- Central ProviderPlugins Registry
```

### Plugin Implementation Standard

Each OpenAI-compatible free provider plugin must follow this pattern:

```typescript
export const LLM7Plugin = PluginV2.make({
  id: PluginV2.ID.make("llm7"),
  name: "LLM7.io",
  effect: (host) =>
    Effect.gen(function* () {
      yield* host.transformCatalog((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("llm7"), (provider) => {
          provider.request = {
            ...provider.request,
            headers: {
              ...provider.request?.headers,
              "HTTP-Referer": "https://opencode.ai/",
              "X-Title": "opencode",
            },
          }
        })
      })
    }),
})
```

---

## Consequences

* **Positive:** New OpenAI-compatible free providers can be added in under 20 lines of code without altering core SDK execution logic.
* **Positive:** Effect-based catalog transforms execute safely during initialization.
* **Neutral:** Unit tests must be provided in `packages/core/test/plugin/provider-<id>.test.ts` for every newly registered provider.
