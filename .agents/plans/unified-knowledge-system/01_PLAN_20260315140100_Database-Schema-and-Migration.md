# Task 1: Database Schema and Migration

**Files:**

- Create: `src/knowledge/knowledge.sql.ts`
- Create: `migration/20260315000000_knowledge_system/migration.sql`
- Modify: `src/storage/schema.ts` (add exports)

**Goal:** Define Drizzle schema for knowledge entries and search index, create migration.

---

## Step 1: Create Drizzle Schema File

Create `src/knowledge/knowledge.sql.ts`:

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { SessionID } from "../session/schema"

export const KnowledgeEntryTable = sqliteTable(
  "knowledge_entry",
  {
    id: text().primaryKey(),
    type: text().notNull(), // "pattern" | "knowledge" | "log"
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    agent: text().notNull(), // "implementer", "shade", "oracle", etc.
    title: text().notNull(),
    description: text().notNull(),
    content: text({ mode: "json" }).notNull(), // Full structured data as JSON
    tags: text({ mode: "json" }).notNull().$type<string[]>(), // ["recovery", "network"]
    tag_weights: text({ mode: "json" }).$type<Record<string, number>>(), // { "critical": 2.0 }
    category: text(), // "architecture", "performance", etc.
    confidence: integer(), // 0-100 (stored as integer)
    first_attempt_failed: integer(), // 0 or 1 (boolean as int)
    impact: text(), // "high" | "medium" | "low"
    related_files: text({ mode: "json" }).$type<string[]>(),
    ...Timestamps,
  },
  (table) => [
    index("knowledge_type_idx").on(table.type),
    index("knowledge_session_idx").on(table.session_id),
    index("knowledge_agent_idx").on(table.agent),
    index("knowledge_created_idx").on(table.time_created),
  ],
)

export const KnowledgeSearchIndexTable = sqliteTable(
  "knowledge_search_index",
  {
    entry_id: text()
      .primaryKey()
      .references(() => KnowledgeEntryTable.id, { onDelete: "cascade" }),
    tag_vector: text().notNull(), // Space-separated tags for FTS
    title_text: text().notNull(), // Lowercased for search
    description_text: text().notNull(),
    ...Timestamps,
  },
  (table) => [index("knowledge_fts_idx").on(table.tag_vector, table.title_text)],
)
```

---

## Step 2: Export Schema in Storage Module

Modify `src/storage/schema.ts` to add:

```typescript
export { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "../knowledge/knowledge.sql"
```

Add this line after the existing exports:

```typescript
export { AccountTable, AccountStateTable, ControlAccountTable } from "../account/account.sql"
export { ProjectTable } from "../project/project.sql"
export { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
export { SessionShareTable } from "../share/share.sql"
export { WorkspaceTable } from "../control-plane/workspace.sql"
export { KnowledgeEntryTable, KnowledgeSearchIndexTable } from "../knowledge/knowledge.sql" // ADD THIS
```

---

## Step 3: Generate Migration SQL

Run Drizzle migration generation:

```bash
cd packages/opencode
bun run db generate --name knowledge_system
```

This creates: `migration/20260315HHMMSS_knowledge_system/migration.sql`

Verify the generated SQL contains:

```sql
CREATE TABLE "knowledge_entry" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "session_id" text,
  "agent" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "content" text NOT NULL,
  "tags" text NOT NULL,
  "tag_weights" text,
  "category" text,
  "confidence" integer,
  "first_attempt_failed" integer,
  "impact" text,
  "related_files" text,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE cascade
);

CREATE INDEX "knowledge_type_idx" on "knowledge_entry" ("type");
CREATE INDEX "knowledge_session_idx" on "knowledge_entry" ("session_id");
CREATE INDEX "knowledge_agent_idx" on "knowledge_entry" ("agent");
CREATE INDEX "knowledge_created_idx" on "knowledge_entry" ("time_created");

CREATE TABLE "knowledge_search_index" (
  "entry_id" text PRIMARY KEY NOT NULL,
  "tag_vector" text NOT NULL,
  "title_text" text NOT NULL,
  "description_text" text NOT NULL,
  "time_created" integer NOT NULL,
  "time_updated" integer NOT NULL,
  FOREIGN KEY ("entry_id") REFERENCES "knowledge_entry" ("id") ON DELETE cascade
);

CREATE INDEX "knowledge_fts_idx" on "knowledge_search_index" ("tag_vector", "title_text");
```

---

## Step 4: Verify Migration

Run database initialization to apply migration:

```bash
cd packages/opencode
bun run db
```

Expected output: Migration applied successfully, no errors.

Verify tables exist:

```bash
sqlite3 ~/.opencode/data/opencode.db ".tables"
```

Should show: `knowledge_entry` and `knowledge_search_index` in the table list.

---

## Step 5: Commit

```bash
git add src/knowledge/knowledge.sql.ts
git add src/storage/schema.ts
git add migration/20260315000000_knowledge_system/migration.sql
git add migration/20260315000000_knowledge_system/snapshot.json
git commit -m "feat: add knowledge system database schema"
```

---

## Acceptance Criteria

✅ `knowledge.sql.ts` created with both tables defined  
✅ Schema exported in `storage/schema.ts`  
✅ Migration generated and applied successfully  
✅ Database tables created with correct indexes  
✅ Foreign key constraints in place  
✅ Commit created
