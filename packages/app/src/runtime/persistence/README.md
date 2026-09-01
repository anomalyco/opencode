# Persisted State

`persisted(target, schema, initial?, platformOverride?)` creates a Solid store whose
type comes from an Effect Schema codec. It returns the store, setter, storage
initialization result, and readiness accessor. Both web and desktop use this
boundary, including cross-window updates.

```ts
const Preferences = Schema.Struct({
  visible: Persistence.defaulted(Schema.Boolean, () => true),
  recent: Persistence.array(Schema.String),
})

type Preferences = typeof Preferences.Type

const [preferences, setPreferences, , ready] = persisted(Persist.global("preferences"), Preferences)
```

Without an explicit initial value, initialization decodes `{}` through the schema.
Dynamic initial values must already satisfy the decoded type. There is no generic
merge with initial state: schemas own missing fields and recovery policies.

- `Persistence.defaulted(schema, factory)` recovers missing, undefined, or invalid
  values. Return fresh collections from the factory.
- `Persistence.array(schema)` defaults to an empty mutable array and discards
  invalid entries individually. Valid entries still pass through their codecs.
- Use ordinary strict schemas where invalid data should reject the document, and
  `Schema.optional` where absence is meaningful. Recovery is not a substitute for
  an explicit historical shape transformation.
- Use mutable array/field schemas when state is edited through Solid `produce`.

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
