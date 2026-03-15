# Acceptance Criteria: opencode-dev-ops

## Testing Correct Patterns

### ✅ CORRECT: Branded ID Types

Branded IDs prevent mix-ups at compile time:

```typescript
const sessionID = SessionID.make('ses_123')
const messageID = MessageID.make('msg_456')
// Type error if you try to swap them
```

### ✅ CORRECT: Snake_case Database Columns

All database columns must use snake_case for consistency:

```typescript
const SessionTable = sqliteTable('session', {
  id: text().<SessionID>().primaryKey(),
  project_id: text().<ProjectID>().notNull(),  // <entity>_id pattern
  time_created: integer(),  // NOT timeCreated
})
```

### ✅ CORRECT: Single-word Variable Names

Use short names when meaning is clear:

```typescript
const log = Log.create({ service: 'session' })
const cfg = Config.get()
const err = new Error('failed')
```

### ✅ CORRECT: Lazy-loaded Routes with OpenAPI

All routes must use lazy() and describeRoute():

```typescript
export const PermissionRoutes = lazy(() =>
  new Hono()
    .post(':requestID/reply', describeRoute({...}), async (c) => {...})
)
```

### ✅ CORRECT: Discriminated Errors

Use Schema.TaggedErrorClass for typed error handling:

```typescript
export class RejectedError extends Schema.TaggedErrorClass(...) {}
export type PermissionError = DeniedError | RejectedError
```

### ✅ CORRECT: Early Returns, No Else

```typescript
function isRoot(id: SessionID) {
  if (id === SessionID.global()) return true
  if (id.endsWith('-root')) return true
  return false
}
```

## Skill Success Criteria

When implementing OpenCode features:
1. All IDs are branded types
2. Database columns use snake_case
3. Routes use lazy() + describeRoute()
4. Errors are discriminated unions
5. No reassignment to let
6. No else blocks
7. Zod validation at boundaries
8. Variables are single-word when clear


