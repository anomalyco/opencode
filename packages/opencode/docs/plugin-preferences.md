Plugin Preference Tabs (SDK)
============================

Overview
--------
This document describes the SDK extension that allows plugins to register preference tabs which are rendered in the Desktop settings UI and accessible via the server API.

Key concepts
- Preference registration: Plugins register a `PreferenceRegistration` (id, title, schema, defaults, ui hints) with the plugin registry. See `packages/opencode/src/plugin/preferences/types.ts`.
- Preference schema: A lightweight JSON-like schema describing fields (string, number, boolean, select, multiselect, file, directory) and validation rules.
- Adapter: The Desktop/TUI clients consume preferences via `packages/opencode/src/preferences/adapter.ts`.
- Server routes: The server exposes REST endpoints under `/preferences` to list tabs, read values, validate and apply changes.

Files
- `packages/opencode/src/plugin/preferences/types.ts` — preference interfaces and Zod schemas
- `packages/opencode/src/plugin/preferences/registry.ts` — in-memory registry plugins use to register
- `packages/opencode/src/preferences/adapter.ts` — client-facing adapter (list, get, validate, apply)
- `packages/opencode/src/server/routes/preferences.ts` — Hono routes mounted at `/preferences`

Usage for plugin authors
------------------------
1. Implement the `preferences` hook in your plugin export. Provide `register`, and optional `validate`, `change`, and `getValues` handlers.

Example registration (TypeScript):

```ts
export default async function Plugin(ctx) {
  return {
    preferences: {
      register: async () => ({
        id: 'small-model-config',
        title: 'Small Model',
        schema: {
          small_model: { type: 'select', description: 'Provider/model', provider: 'models' }
        },
        defaults: { small_model: 'lmstudio-local/phi-4-mini' }
      }),
      validate: async ({ key, value }) => ({ valid: true }),
      change: async ({ key, value }) => { /* persist via ctx.client.config.set */ }
    }
  }
}
```

Client integration
------------------
Desktop and TUI clients can query the server endpoints:
- `GET /preferences` — list registered tabs
- `GET /preferences/:pluginId/values` — get current values
- `POST /preferences/:pluginId/validate` — body `{ key, value }` returns validation result
- `POST /preferences/:pluginId/apply` — body `{ key, value }` applies change and persists to project config under `plugin_preferences.<pluginId>.<key>`

Notes
- Persistence: changes applied via the adapter are persisted to the project `opencode.jsonc` under `plugin_preferences` namespace by default to avoid collisions.
- Restart: preference registrations can set `requiresRestart` — clients should show a restart prompt when appropriate.
- Hot-reload: dynamic refresh (no restart) is an enhancement tracked under issue #10899 and will be integrated once available.

Security and validation
-----------------------
Plugins should validate values using the `validate` hook. Clients should call the validate endpoint before applying changes. The adapter also performs schema checks before invoking `change` handlers.
