# Entity Definitions Reference

**Version:** 1.0  
**Last Updated:** March 2026  
**Scope:** OpenCode Core Entities and Type System

This document provides a comprehensive reference for all core entity types in OpenCode. It's organized by domain and includes field definitions, relationships, discriminators, and storage patterns.

---

## Quick Navigation

- [Session & Message Types](#session--message-types)
- [Tool & Capability Types](#tool--capability-types)
- [Permission & Auth Types](#permission--auth-types)
- [Provider & Model Types](#provider--model-types)
- [Project & Workspace Types](#project--workspace-types)
- [Error & Response Types](#error--response-types)
- [Entity Relationships](#entity-relationships)
- [Discriminated Unions](#discriminated-unions)
- [Storage & Serialization](#storage--serialization)

---

## Session & Message Types

### SessionID (Branded Type)

**File:** `packages/opencode/src/session/schema.ts`  
**Type:** Effect Schema + Brand + Static Methods  
**Purpose:** Unique identifier for a chat session

**Definition:**
```typescript
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

**Key Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `id` | string (branded) | Unique session identifier |

**Static Methods:**
| Method | Returns | Purpose |
|--------|---------|---------|
| `SessionID.make(id)` | SessionID | Create session ID from raw string |
| `SessionID.descending(id?)` | SessionID | Generate descending-sorted ID |
| `SessionID.zod` | ZodType | Zod validation schema |

**Usage:**
```typescript
const id = SessionID.make("ses_123abc")
const desc = SessionID.descending()  // Generates sortable ID
```

---

### MessageID (Branded Type)

**File:** `packages/opencode/src/session/schema.ts`  
**Type:** Effect Schema + Brand + Static Methods  
**Purpose:** Unique identifier for a message within a session

**Similar to SessionID with methods:**
- `MessageID.make(id)` - Create message ID
- `MessageID.ascending(id?)` - Generate ascending-sorted ID
- `MessageID.zod` - Zod schema

---

### PartID (Branded Type)

**File:** `packages/opencode/src/session/schema.ts`  
**Type:** Effect Schema + Brand  
**Purpose:** Unique identifier for a message part (sub-unit of a message)

**Similar structure to MessageID with:**
- `PartID.make(id)` - Create part ID
- `PartID.ascending(id?)` - Generate ascending-sorted ID
- `PartID.zod` - Zod schema

---

### SessionTable (Database Schema)

**File:** `packages/opencode/src/session/session.sql.ts`  
**Type:** Drizzle ORM Table Schema  
**Purpose:** Persistent storage for session metadata

**Fields:**
```typescript
id: text.$type<SessionID>().primaryKey()
project_id: text.$type<ProjectID>().notNull()  // FK to ProjectTable
workspace_id: text.$type<WorkspaceID>()  // FK to WorkspaceTable (nullable)
parent_id: text.$type<SessionID>()  // Self-reference for child sessions
slug: text.notNull()  // URL-safe session name
directory: text.notNull()  // Working directory for agent
title: text.notNull()  // Display name
version: text.notNull()  // Schema version
share_url: text  // Public share URL (nullable)
summary_additions: integer  // Lines added in diff
summary_deletions: integer  // Lines deleted in diff
summary_files: integer  // Files changed in diff
summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>()  // Detailed file diffs
revert: text({ mode: "json" })  // Revert information
permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>()  // Permission rules
time_created: integer  // Unix timestamp
time_updated: integer  // Unix timestamp
time_compacting: integer  // Last compaction time
time_archived: integer  // Archive timestamp
```

**Indexes:**
- `session_project_idx` on `project_id`
- `session_workspace_idx` on `workspace_id`
- `session_parent_idx` on `parent_id`

**Relationships:**
| Column | References | Constraint |
|--------|------------|-----------|
| `project_id` | ProjectTable.id | Foreign Key (cascade delete) |
| `workspace_id` | WorkspaceTable.id | Foreign Key, nullable |
| `parent_id` | SessionTable.id | Self-reference, nullable |

**Lifecycle:**
- Created when new session starts
- Updated when session receives new messages
- Archived when session is manually archived
- Compacted periodically to manage message history

---

### MessageV2.User (Discriminated Union)

**File:** `packages/opencode/src/session/message-v2.ts`  
**Type:** Discriminated Union (role: 'user')  
**Purpose:** Represents a user-initiated message in a session

**Fields:**
```typescript
id: MessageID  // Primary key
sessionID: SessionID  // Parent session
role: 'user'  // Discriminator literal
time: {
  created: number  // Unix timestamp
}
format?: OutputFormat  // OutputFormatText | OutputFormatJsonSchema
summary?: {
  title?: string
  body?: string
  diffs?: Snapshot.FileDiff[]
}
agent: string  // Agent name handling this message
model: {
  providerID: ProviderID  // LLM provider
  modelID: ModelID  // Model identifier
}
system?: string  // System prompt override
tools?: Record<string, boolean>  // Tools to enable/disable
variant?: string  // Model variant
```

**Stored In:** MessageTable.data (JSON column)

**Example:**
```typescript
const msg: MessageV2.User = {
  id: MessageID.make("msg_abc"),
  sessionID: SessionID.make("ses_123"),
  role: "user",
  time: { created: Date.now() },
  agent: "primary",
  model: {
    providerID: ProviderID.make("anthropic"),
    modelID: ModelID.make("claude-4"),
  },
  system: "You are an expert code reviewer",
}
```

---

### MessageV2.Assistant (Discriminated Union)

**File:** `packages/opencode/src/session/message-v2.ts`  
**Type:** Discriminated Union (role: 'assistant')  
**Purpose:** Represents an AI assistant response

**Fields:**
```typescript
id: MessageID  // Primary key
sessionID: SessionID  // Parent session
role: 'assistant'  // Discriminator literal
time: {
  created: number  // When response started
  completed?: number  // When response finished (nullable)
}
error?: MessageV2.ErrorInfo  // Error if response failed
parentID: MessageID  // User message this responds to
modelID: ModelID  // Which model generated this
providerID: ProviderID  // Which provider
mode?: string  // Deprecated field
agent: string  // Agent name
path: {
  cwd: string  // Current working directory during execution
  root: string  // Project root
}
summary?: boolean  // Is this a summary message?
cost: number  // Estimated LLM cost in USD
tokens: {
  total: number
  input: number
  output: number
  reasoning?: number  // For reasoning models
  cache?: {
    read: number
    write: number
  }
}
structured?: any  // Structured output from model
variant?: string  // Model variant used
finish?: string  // Finish reason
```

**Error Types:**
- `OutputLengthError` - Response was truncated
- `AbortedError` - User aborted the response
- `StructuredOutputError` - Structured output parsing failed
- `AuthError` - Authentication failed with provider
- `APIError` - API returned an error
- `ContextOverflowError` - Too many tokens

**Stored In:** MessageTable.data (JSON column)

---

### MessageV2.Part (Discriminated Union)

**File:** `packages/opencode/src/session/message-v2.ts`  
**Type:** Discriminated Union with 12 Variants  
**Purpose:** Represents a sub-unit of a message

**Discriminator:** `type` field with values:

#### TextPart
```typescript
type: 'text'
text: string
synthetic?: boolean  // Was this synthesized by the system?
ignored?: boolean  // Was this part ignored?
time: {
  start: number
  end?: number
}
metadata?: Record<string, any>
```

#### ToolPart
```typescript
type: 'tool'
callID: string  // Unique call identifier
tool: string  // Tool name (e.g., "read", "bash", "edit")
state: ToolSt
