# @opencode-ai/database

Custom graph database module for the opencode agentic system.

## Architecture

- **GraphDB** — stores entities (tools, skills, notes) and their relationships in SQLite
- **VectorDB** — semantic search via embeddings (planned)

## Schema

- `src/**/*.sql.ts` — Drizzle schema files
- Tables and columns use snake_case
- Join columns: `<entity>_id`
- Indexes: `<table>_<column>_idx`

## Migrations

```bash
bun run db generate --name <slug>
```

Output: `migration/<timestamp>_<slug>/migration.sql` + `snapshot.json`

## Service pattern

```ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode-ai/database/ServiceName") {}
export const layer = Layer.effect(Service, Effect.gen(function* () { ... })).pipe(Layer.provide(Database.layerMemory))
export * as ServiceName from "./file"
```

## Usage

```ts
import { EntityRepo, RelationRepo, Database } from "@opencode-ai/database"

const layer = Layer.mergeAll(EntityRepo.layer, RelationRepo.layer)

Effect.runPromise(
  Effect.gen(function* () {
    const entities = yield* EntityRepo
    const relations = yield* RelationRepo
    // ...
  }).pipe(Effect.provide(layer)),
)
```
