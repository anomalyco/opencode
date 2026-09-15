# Catalog / Config / Plugin Lifecycle Options

Status: current core has selected replayable Location-scoped Catalog transforms, aligned with option B. Reload/watch behavior and deferred external plugin activation remain design work; the option comparison below is retained as historical context.

We need to choose where provider/model inputs live and how visible catalog state changes after boot. The designs below compare config, models.dev, auth, plugin activation/disablement, config edits, and policy changes under each option.

## Scenarios

- Initial load: a location opens, built-in/configured plugins activate, and the first visible catalog is constructed.
- Config: authored provider/model definitions and overrides.
- models.dev: remote provider/model data refreshed on a timer.
- Auth: active credentials enable/configure providers and can later disappear.
- Plugin activation: a plugin starts contributing while the location is open.
- Plugin disablement: a plugin stops contributing and its influence must disappear.
- Config edit: authored configuration changes while the location is open.
- Policy: allowed/denied provider selection changes after providers exist.

## A. Config Transforms, Service Reload

`Config` merges its ordered documents and then runs ordered, replayable plugin transforms. Each transform is a callback receiving `Draft<Config.Info>` and may mutate any config field.

```ts
type ConfigTransform = (config: Draft<Config.Info>) => void

const transform = yield * Config.transform()

yield *
  transform((config) => {
    config.providers ??= {}
    config.providers.acme = {
      /* ... */
    }
    config.model = "acme/code"
    config.permissions = [
      /* ... */
    ]
  })
```

Because a transform can mutate any part of config, a transform change cannot safely trigger only `Catalog.reload()` or any other granular subset. Every service derived from config must reload in place from the newly transformed config.

```ts
const transform = yield* Config.transform()
yield* transform((draft) => mutateAnyConfigField(draft))
  → Reload.all()
    → Policy.reload()
    → Catalog.reload()
    → Agent.reload()
    → MCP.reload()
    → other config-consuming services reload
```

### Initial Load

Configured plugin installation/updates should not block location readiness. Build an initial snapshot from authored config and fast built-ins, then activate slow plugins in the background and coalesce their resulting reload requests.

```ts
LocationServiceMap.get(ref)
  → build location layer
    → Config.layer reads authored documents
      → merge authored documents
      → run currently active Config transforms
    → Policy.layer reads transformed Config
    → Catalog.layer reads transformed Config
      → materialize baseline provider/model catalog
  → PluginBoot baseline ready
    → Frontend.fetchCatalog()

PluginBoot background fiber
  → install/update plugin packages concurrently
  → activate completed plugins
    → Config.transform()
      → transform(updateConfig)
    → ReloadScheduler.request()
      → debounce short burst of completed activations
      → Reload.all()
        → Config.get()
          → run newly active Config transforms
        → Catalog.reload()
          → Catalog.Event.Updated
            → Frontend.refetchCatalog()
```

The initial layer build is not a reload. `Reload.all()` only runs after the live location changes, such as a background plugin becoming active or a config source changing. Debouncing reduces repeated full-service reloads when multiple plugins complete near each other; each batch still reloads every config-consuming service because a config transform may mutate any field.

### Config

```ts
config file loaded
  → config source/watch trigger records new documents
    → Reload.all()
      → Policy.reload()
      → Catalog.reload()
        → Catalog.Event.Updated
          → Frontend.refetchCatalog()
```

### models.dev

```ts
timer fires
  → ModelsDevPlugin.refresh()
    → ModelsDev.get()
    → transform(applyModelsDevToConfig)
    → Reload.all()
      → Policy.reload()
      → Catalog.reload()
        → Catalog.Event.Updated
          → Frontend.refetchCatalog()
```

`Catalog` does not know about `ModelsDev`; the plugin transforms config before catalog reads it.

### Auth

```ts
Account.switched(providerID)
  → AuthPlugin.refresh(providerID)
    → Account.active(providerID)
    → transform(applyAuthToConfig)
    → Reload.all()
      → Policy.reload()
      → Catalog.reload()
        → Catalog.Event.Updated
          → Frontend.refetchCatalog()
```

### Plugin Activation

```ts
Plugin.activate("acme-models")
  → Config.transform()
    → transform(applyAcmeConfig)
  → Reload.all()
    → Policy.reload()
    → Catalog.reload()
      → Catalog.Event.Updated
        → Frontend.refetchCatalog()
```

### Plugin Disablement

```ts
Plugin.disable("company-naming")
  → close plugin scope
    → Config internally unregisters transform in finalizer
  → Reload.all()
    → Policy.reload()
    → Catalog.reload()
      → sonnet.name = "Sonnet"
      → Catalog.Event.Updated
        → Frontend.refetchCatalog()
```

### Config Edit

```ts
file watcher sees edit
  → config source/watch trigger records updated documents
  → Reload.all()
    → Policy.reload()
    → Catalog.reload()
      → Catalog.Event.Updated
        → Frontend.refetchCatalog()
```

### Policy

```ts
policy config changes
  → config source/watch trigger records updated documents
  → Reload.all()
    → Policy.reload()
    → Catalog.reload()
      → apply updated policy
      → Catalog.Event.Updated
        → Frontend.refetchCatalog()
```

### Tradeoffs

- A plugin receives `Draft<Config.Info>`, can inspect preceding config state, and can mutate arbitrary config fields through a replayable transform.
- Plugin disablement removes its config transform and lets services rematerialize without manual undo.
- models.dev and auth become config transforms rather than catalog dependencies.
- `Config` owns merge/order semantics for fields visible to transforms.
- Granular service reload is not safe because a config transform can mutate anything; every config-consuming service reloads after any transform change.
- `Catalog` depends on provider/model config semantics and is part of that full service reload.
- One reload produces at most one `Catalog.Event.Updated` notification.
- Deferred plugin activation avoids blocking readiness, but plugin completions may cause repeated full-service reload batches during startup.

## B. Catalog Transforms

Plugins register replayable catalog transforms. Each transform receives a `Catalog.Editor` whose helper methods mutate a private catalog draft; `Catalog` rematerializes visible records from its active transforms.

```ts
interface Catalog {
  transform(): Effect.Effect<(update: (catalog: Catalog.Editor) => void) => Effect.Effect<void>, never, Scope.Scope>
}
```

```ts
const transform = yield* Catalog.transform()
yield* transform(update)
  → replace this transform callback
  → apply active transforms in registration order
  → apply policy
  → commit diff
    → Event.publish(Catalog.Event.Updated)
      → Frontend.refetchCatalog()
```

### Initial Load

Configured plugin installation/updates should not block location readiness. Build an initial catalog from immediately available sources, then activate slow plugins in the background and coalesce refresh requests.

```ts
LocationServiceMap.get(ref)
  → build location layer
    → Catalog.layer creates empty catalog state
    → PluginBoot.layer activates immediately available plugins
      → ConfigProviderPlugin installs Catalog.transform()
      → ModelsDevPlugin installs Catalog.transform()
      → AuthPlugin installs Catalog.transform()
    → Catalog.layer applies active transforms during boot
    → apply policy
    → materialize baseline provider/model catalog
  → PluginBoot baseline ready
    → Frontend.fetchCatalog()

PluginBoot background fiber
  → install/update plugin packages concurrently
  → activate completed plugins
    → Catalog.transform()
      → transform(updateCatalog)
        → Catalog internally rebuilds
          → Catalog.Event.Updated
            → Frontend.refetchCatalog()
```

Each completed plugin activation rebuilds catalog when it calls its transform. Debouncing plugin completions would require adding an explicit batch/suspend-rebuild mechanism; it does not arise from the transform interface itself.

### Config

```ts
config file loaded
  → ConfigProviderAdapter.load()
    → transform(applyConfigToCatalog)
      → Catalog internally rebuilds
```

### models.dev

```ts
timer fires
  → ModelsDevPlugin.refresh()
    → ModelsDev.get()
    → transform(applyModelsDevToCatalog)
      → Catalog internally rebuilds
      → commit diff
```

### Auth

```ts
Account.switched(providerID)
  → AuthPlugin.refresh()
    → transform(applyAuthToCatalog)
      → Catalog internally rebuilds
        → replay active transforms including current auth
        → apply policy
        → commit diff
```

### Plugin Activation

```ts
Plugin.activate("acme-models")
  → Catalog.transform()
    → transform(applyAcmeToCatalog)
    → Catalog internally rebuilds
      → commit diff
```

### Plugin Disablement

```ts
Plugin.disable("company-naming")
  → close plugin scope
    → Catalog internally unregisters transform in finalizer
    → Catalog internally rebuilds
      → sonnet.name = "Sonnet"
      → commit diff
```

### Config Edit

```ts
file watcher sees edit
  → ConfigProviderAdapter.load()
    → transform(applyUpdatedConfigToCatalog)
      → Catalog internally rebuilds
```

### Policy

```ts
policy changes
  → Catalog rebuild trigger
    → replay all active transforms
    → apply updated policy last
    → commit diff
```

### Tradeoffs

- Disablement, source refresh, and policy re-evaluation are transform replay operations.
- Auth does not need to be represented as config.
- Config remains one catalog source rather than a catalog dependency.
- The API shape matches A, but the mutable draft is catalog state instead of configuration state.
- Catalog needs transform ordering and internal rebuild behavior in addition to reads.
- Recompute ordering, serialization, and diff events must be specified.
- One internal rebuild produces at most one `Catalog.Event.Updated` notification.
- Deferred plugin activation avoids blocking readiness and only rebuilds catalog for catalog transform changes.
- Debouncing those rebuilds needs an additional batching interface or an activation coordinator that installs multiple transforms before exposing updates.
