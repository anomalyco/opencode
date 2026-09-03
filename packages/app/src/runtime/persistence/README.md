# Persisted State

`persisted(target, schema, initial, platformOverride?)` creates a Solid store whose
type comes from an Effect Schema codec. The required `initial` value supplies
store defaults and is checked against that type. The function returns the store, setter, storage
initialization result, and readiness accessor. Both web and desktop use this
boundary, including cross-window updates.

```ts
const Preferences = Persistence.struct({
  visible: Schema.Boolean,
  mode: Schema.Literals(["normal", "shell"]),
  directory: Persistence.optional(Schema.String),
  recent: Persistence.array(Schema.String),
})

type Preferences = typeof Preferences.Type

const [preferences, setPreferences, , ready] = persisted(Persist.global("preferences"), Preferences, {
  visible: true,
  mode: "normal",
  recent: [],
})
```

Keep initialization defaults in `initial`, not repeated across schema fields.
Plain struct fields recover independently from the corresponding initial value;
the resulting state is validated before entering the store. Arrays replace rather
than index-merge, explicit `null` is retained when allowed, and missing optional
values can inherit dynamic initial defaults.

Field codecs decode atomically, so the persistence layer does not attempt to
interpret arbitrary transformations. Collection-entry recovery and genuine
migration rules remain explicit in their schemas.

- `Persistence.fallback(schema, factory)` deliberately recovers invalid values as
  well as missing or undefined input. Use it for domain-specific recovery, such as
  defaults inside collection entries, not ordinary store initialization.
- `Persistence.optional(schema)` omits invalid fields as well as accepting missing
  or undefined input. Use ordinary `Schema.optional` when no codec-local recovery
  is needed; the initialized store boundary still recovers fields from `initial`.
- `Persistence.struct(fields)` makes fields mutable for Solid stores while preserving
  each field's optionality and codec. It does not add defaults or error recovery.
- `Persistence.record(valueSchema)` creates a mutable string-keyed record, defaulting
  missing or invalid records to a fresh `{}`. Its value schema determines entry
  recovery: pass `Persistence.optional(valueSchema)` to discard only invalid entries,
  or `Persistence.fallback(valueSchema, factory)` to replace those entries.
- `Persistence.array(schema)` defaults to an empty mutable array and discards
  invalid entries individually. Valid entries still pass through their codecs.
- Recovery is not a substitute for an explicit historical shape transformation.

## Migrations

Describe shipped representations with schemas and transform their typed values
using `Schema.decode` or `Schema.decodeTo` and `SchemaGetter`. For whole-object
migrations, pass `Persistence.migrate(currentSchema, storedCodec)` instead of the
plain schema. The stored codec runs before defaults are applied, preserving
distinctions such as an absent current field identifying an older format. It
returns a candidate in the current encoded shape; the current schema then owns
recovery and validation.

The migration reader preserves excess properties so a migration can describe
only the fields it observes without dropping unrelated saved preferences. The
current schema strips fields outside its contract. Writes use only the current
schema's encoder, never the legacy reader's encoder.

`Persistence.withInitial(schemaOrMigration, initial)` exposes the same initialized
codec for focused tests. Test canonical encoding and decode/encode/decode stability
as well as historical fixtures.

Reads normalize stored JSON through decoding and encoding, writing back the
canonical representation when it changed. Invalid documents fall back to initial
state; malformed individual values can instead be recovered by their schemas.
Cross-window values are decoded before entering the store. Writes use the same
codec's encoder.

Storage-key relocation (`previousKey`, workspace aliases, draft storage moves)
remains separate from schema migration. Draft blob externalization and hydration
also remain in the storage adapter: composer codecs receive hydrated references,
not raw ID-only blob documents.
