# Persisted State

`persisted(target, schema, initial?, platformOverride?)` creates a Solid store whose
type comes from an Effect Schema codec. It returns the store, setter, storage
initialization result, and readiness accessor. Both web and desktop use this
boundary, including cross-window updates.

```ts
const Preferences = Persistence.struct({
  visible: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  mode: Persistence.fallback(Schema.Literals(["normal", "shell"]), () => "normal" as const),
  directory: Persistence.optional(Schema.String),
  recent: Persistence.array(Schema.String),
})

type Preferences = typeof Preferences.Type

const [preferences, setPreferences, , ready] = persisted(Persist.global("preferences"), Preferences)
```

Without an explicit initial value, initialization decodes `{}` through the schema.
Dynamic initial values must already satisfy the decoded type. There is no generic
merge with initial state: schemas own missing fields and recovery policies.

- Use `Schema.withDecodingDefault` for missing or undefined input. It already makes
  the input optional and still rejects invalid values. Use `withDecodingDefaultType`
  when the default is already in the decoded representation of a transformation.
- `Persistence.fallback(schema, factory)` deliberately recovers invalid values as
  well as missing or undefined input. Return fresh collections from the factory.
- `Persistence.optional(schema)` omits invalid fields as well as accepting missing
  or undefined input. Use ordinary `Schema.optional` when invalid values should fail.
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
using `Schema.decodeTo` and `SchemaGetter`. Always validate the resulting current
shape. The codec's encoder must emit **only the current representation**, not
reverse the migration to an old representation. Test canonical encoding and
decode/encode/decode stability as well as historical fixtures.

Reads normalize stored JSON through decoding and encoding, writing back the
canonical representation when it changed. Invalid documents fall back to initial
state; malformed individual values can instead be recovered by their schemas.
Cross-window values are decoded before entering the store. Writes use the same
codec's encoder.

Storage-key relocation (`previousKey`, workspace aliases, draft storage moves)
remains separate from schema migration. Draft blob externalization and hydration
also remain in the storage adapter: composer codecs receive hydrated references,
not raw ID-only blob documents.
