---
name: opencode-dev-ops
description: Use when contributing to OpenCode codebase, implementing features, fixing bugs, or creating new patterns. Provides governance rules, development standards, and contribution guidelines specific to OpenCode's architecture and established practices. Triggers: "contribute to OpenCode", "implement feature", "OpenCode standards", "codebase patterns", "permission system", "message flow", "entity types".
---

# OpenCode Development Operations

**Agent:** Implementer, Aegis Prime (Coordinator)  
**Phase:** Feature Development, Bug Fixes, Contribution  
**Previous Skill:** brainstorming (for design), systematic-debugging (for bugs)  
**Next Skill:** verification-before-completion (before claiming code is ready)  
**Subagents Used:** None (this is guidance; you implement directly)

## Overview

This skill encodes OpenCode's established development standards, architecture patterns, and governance rules. It ensures contributions align with the codebase's type-safety-first approach, functional programming discipline, and multi-layered architecture.

**Core Principle:** OpenCode values runtime safety through type systems (Effect Schema + Zod), immutability, early returns, and clear separation of concerns. Follow the patterns you see in the code—they're not arbitrary.

## Integration with Delegation Flow

This skill activates when:
1. **Aegis Prime** is about to implement features in OpenCode
2. **Implementer** needs to know OpenCode-specific standards
3. **Anyone** is unsure about naming, type safety, or architectural boundaries

**When to invoke:**
- Before writing ANY code in packages/opencode
- Before creating database schemas or API routes
- Before implementing permission checks or error handling
- When adding new tool implementations
- When unsure about file structure or module organization

## How to Use This Skill

### Step 1: Identify Your Task Category

**Contributing to OpenCode involves:**
- Adding new tools (read, write, bash, etc.)
- Creating new entity types (Session, Message, Part variations)
- Implementing API routes (Hono with OpenAPI)
- Writing database schemas (Drizzle ORM)
- Adding permission rules or auth flows
- Implementing message processing logic
- Refactoring existing code

### Step 2: Consult Relevant Section

Navigate to the section matching your task:
- **[Naming & File Structure](#naming--file-structure)** - Before creating any file
- **[Type Safety & Branded IDs](#type-safety--branded-ids)** - Before defining entities
- **[Database Schemas](#database-schemas)** - Before touching Drizzle
- **[API Routes & Validation](#api-routes--validation)** - Before implementing routes
- **[Error Handling](#error-handling)** - Before handling errors
- **[Tool Implementation](#tool-implementation)** - Before creating tools
- **[Permission System](#permission-system)** - Before permission checks
- **[Functional Patterns](#functional-patterns)** - For code style

### Step 3: Follow the Patterns

Each section includes:
- **Pattern Definition** - How OpenCode actually does this
- **Code Examples** - Real examples from the codebase
- **Anti-Patterns** - What NOT to do
- **Verification Checklist** - How to know you got it right

---

## Core Principles

### 1. Type Safety First

**Everything has a type.** No `any` types. Use:
- **Branded IDs** for unique identifiers (SessionID, MessageID, etc.)
- **Zod schemas** for serialization boundaries and API validation
- **Effect Schema** for core domain entities
- **Discriminated unions** for polymorphism

```typescript
// GOOD: Branded types prevent mixing IDs
const sessionID = SessionID.make("ses_123")
const messageID = MessageID.make("msg_456")
// sessionID and messageID are NOT interchangeable

// BAD: Any allows confusion
const sessionID: any = "ses_123"
const messageID: any = "msg_456"  // Could pass sessionID by mistake
```

### 2. Immutability & Functional Style

**Avoid mutations.** Use:
- `const` instead of `let`
- Ternary operators instead of reassignment
- Early returns instead of else blocks
- Functional array methods (map, filter, flatMap) instead of loops

```typescript
// GOOD: Immutable
const title = isChild ? "Child session" : "New session"

// BAD: Mutable reassignment
let title = "New session"
if (isChild) title = "Child session"
```

### 3. Single Responsibility & Composition

**Each module does one thing well.** Don't cross architectural layers.
- **Persistence Layer** - Database access only (Drizzle queries)
- **Service Layer** - Business logic using persistence
- **API Layer** - HTTP endpoints using services
- **Frontend** - UI consuming APIs

### 4. Explicit Over Implicit

**Make assumptions visible.** If code depends on context:
- Pass it explicitly (parameters, context objects)
- Don't rely on global state
- Validate at boundaries (Zod schemas, permission checks)

---

## Naming & File Structure

### Variables: Single Word When Possible

```typescript
// Preferred: Single-word names when clear
const log = Log.create({ service: "session" })
const state = Instance.state(...)
const cfg = Config.get()
const err = new Error("failed")

// Allow multi-word when necessary for clarity
let closed = false  // Boolean states sometimes need more words
const decoded = Schema.decodeUnknownOption(Info)
```

### Files: Lowercase with Hyphens or Descriptive

```
session/
  ├── schema.ts        ← Type definitions
  ├── session.sql.ts   ← Database schema
  ├── service.ts       ← Business logic
  ├── index.ts         ← Public exports
  └── *.test.ts        ← Tests (colocated, run from package dir)

routes/
  ├── session.ts       ← Session API endpoints
  ├── permission.ts    ← Permission API endpoints
  └── provider.ts      ← Provider API endpoints
```

### Modules: Namespace Pattern

```typescript
// Export as namespace - don't default export
export namespace Session {
  const log = Log.create({ service: "session" })
  
  // Types
  export type Info = z.infer<typeof Info>
  
  // Functions
  export async function create(input: CreateInput): Promise<Info> { ... }
  export async function* list(opts: ListOpts): AsyncGenerator<Info> { ... }
}

// Usage: Provides context
const s = await Session.create({...})
for await (const item of Session.list({...})) { ... }
```

### Database Columns: Always snake_case

```typescript
// REQUIRED for Drizzle schemas - use snake_case
const SessionTable = sqliteTable("session", {
  id: text().$type<SessionID>().primaryKey(),
  project_id: text().$type<ProjectID>().notNull(),  // NOT projectID
  time_created: integer(),  // NOT timeCreated
  time_updated: integer(),  // NOT timeUpdated
}, (table) => [
  index("session_project_idx").on(table.project_id),  // Pattern: <table>_<col>_<suffix>
])
```

---

## Type Safety & Branded IDs

### Branded String Pattern (Preferred)

Use when you need sortable IDs with static helper methods:

```typescript
// session/schema.ts
export const SessionID = Schema.String.pipe(
  Schema.brand("SessionID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("session", id)),
    zod: Identifier.schema("session").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type SessionID = Schema.Schema.Type<typeof SessionID>
```

**Usage:**
```typescript
const id = SessionID.make("ses_abc123")
const desc = SessionID.descending()  // For reverse-sorted queries
```

### Newtype Class Pattern

Use when you just need a simple branded type:

```typescript
export class PermissionID extends Newtype<PermissionID>()("PermissionID", Schema.String) {
  static make(id: string): PermissionID {
    return this.makeUnsafe(id)
  }
  static readonly zod = Identifier.schema("permission") as unknown as z.ZodType<PermissionID>
}
```

### Zod for Serialization Boundaries

Always validate at API boundaries:

```typescript
// Use .meta() for OpenAPI documentation
export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})

export const Rule = z.object({
  permission: z.string(),
  pattern: z.string(),
