
## WS0.5: SettingDefinition Discriminated Union (2026-03-01)

### Approach
- Replaced flat `SettingDefinition` type with 7 specific exported types: `StringSetting`, `NumberSetting`, `BooleanSetting`, `SelectSetting`, `SecretSetting`, `ObjectSetting`, `ArraySetting`
- `SettingDefinition` is now a union of all 7 types, discriminated by the `type` field
- `SelectSetting` strictly requires `enum: string[]` (not optional)
- `ObjectSetting` has optional `properties?: Record<string, SettingDefinition>` for nested settings
- `ArraySetting` has optional `items?: SettingDefinition` for typed array elements
- All 7 types are exported individually for SDK gen and downstream consumers

### Key Decisions
- `default` type is specific per setting type (e.g., `string` for StringSetting, `number` for NumberSetting)
- `BooleanSetting` has no `placeholder` field (irrelevant for booleans)
- Recursive references in `ObjectSetting.properties` and `ArraySetting.items` use `SettingDefinition` (the union type), which TypeScript handles correctly

### Verification
- `bun run tsc --noEmit` in `packages/plugin` passes with zero errors

## Task 0.3 + 0.4: PATCH merge & OpenAPI schema hardening (config.ts)

### Shallow merge (0.3)
- Changed line in PATCH `/plugin-settings` handler from:
  `[body.plugin_id]: body.settings`  
  to:
  `[body.plugin_id]: { ...config.plugin_settings?.[body.plugin_id], ...body.settings }`
- This preserves existing plugin keys not included in the PATCH body.

### OpenAPI schema strengthening (0.4)
- `PluginSettingsSchema` lives in `packages/plugin/src/index.ts` (not in opencode package)
- `SettingDefinition` is a discriminated union on `type` field with 7 variants:
  `string | number | boolean | select | secret | object | array`
- Replaced `z.array(z.unknown())` with full Zod discriminated union matching the TypeScript type.
- `z.discriminatedUnion("type", [...])` works correctly with Zod v4 in this codebase.
- `object` type's `properties` field is recursive – used `z.record(z.string(), z.unknown())` to avoid deep recursion issues.
- `array` type's `items` field is also recursive – used `z.unknown()`.
- `bun --cwd packages/opencode tsc --noEmit` passes clean.

### Convention
- No external imports were needed; `PluginSettingsSchema` type is matched structurally via inline Zod schemas.

## settings-plugins.tsx UI robustness
- **SolidJS label 'for' vs 'htmlFor'**: In SolidJS, `<label for={...}>` is the standard JSX prop for linking a label to an input.
- **Handling Number Input Empty Values**: `<TextField type="number">` will receive `e.currentTarget.value === ""` when cleared. Parsing `""` with `Number()` yields `0`. To properly clear an optional number without setting `0` or `NaN`, explicitly check for `""` and map it to `undefined` before saving to state.
- **API Schema Safely Rendering**: Always defend against malformed plugin schema elements in `For` loops by verifying `schema`, `schema.id`, and `schema.properties` shape, simply rendering `null` for invalid items to prevent whole page crashes.

## WS3: legacyConfig hook (2026-03-01)

### Type Definition (packages/plugin/src/index.ts)
Added `legacyConfig?` to `Hooks` interface:
```ts
legacyConfig?: {
  files: Array<{ path: string; format: "json" | "jsonc" | "yaml" | "toml"; scope: "global" | "project" }>
  migrate: (raw: unknown) => Record<string, unknown>
}
```
Also excluded `legacyConfig` and `config` from `trigger()` type constraint in loader.

### Loader Implementation (packages/opencode/src/plugin/index.ts)
- Added `pluginHookMap: { id: string; hook: Hooks }[]` alongside `hooks: Hooks[]` in state.
- Internal plugins: `id = plugin.name`, External plugins: `id = Config.getPluginName(plugin)`.
- `init()` now iterates `pluginHookMap` and for each entry with `legacyConfig`:
  1. Checks `config.plugin_settings?.[id]` — skips if non-empty (idempotent).
  2. Tries each file in `legacyConfig.files` via `Bun.file(path).exists()` + `.json()`.
  3. Calls `migrate(raw)`, then double-checks settings still empty (re-fetches config).
  4. Calls `Config.update({ plugin_settings: { ...current, [id]: migrated } })`.
  5. Errors during parse are caught and logged as warnings (no crash).
- Uses `Bun.file().json()` for parsing (handles standard JSON); JSONC/YAML/TOML not yet parsed differently.

### Key Constraints
- Idempotency: `Object.keys(existing).length > 0` guard prevents re-migration.
- No deletion of legacy files (by design).
- try/catch per file — invalid JSON logs warning, tries next file.
- Plugin identification: Internal plugins use their function names as IDs, while external plugins use their canonical package name or filename (via `Config.getPluginName`).
- Injecting settings: Each plugin is initialized with its own `PluginInput` that contains only its specific settings from `config.plugin_settings`.
- Shared logic: The loader (`packages/opencode/src/plugin/index.ts`) serves as the central point for mapping configurations to plugin instances.
