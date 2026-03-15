# Error Handling Guide: opencode-dev-ops

## Error Type Hierarchy

OpenCode uses three patterns for errors:

### 1. Schema.TaggedErrorClass (Core Domain Errors)

Use for errors that represent domain failures (permission denied, auth failed, etc.)

```typescript
export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "User rejected permission to use this specific tool call."
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return "User has specified rules preventing this tool call"
  }
}

export type PermissionError = DeniedError | RejectedError | CorrectedError
```

**When to use:**
- Domain-level failures (auth, permission, validation)
- Errors that need structured handling
- Part of error discriminated unions

### 2. Traditional Error Classes (Low-Level Errors)

Use for system-level errors (process failed, file I/O, etc.)

```typescript
export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text 
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}
```

**When to use:**
- Low-level system errors
- Need to capture additional data (stdout, stderr, code)
- Specific error subclass for instanceof checks

### 3. Message Error Union Types

For LLM response errors:

```typescript
export type MessageV2.ErrorInfo = 
  | OutputLengthError
  | AbortedError
  | StructuredOutputError
  | AuthError
  | APIError
  | ContextOverflowError
```

---

## Error Handling Patterns

### Pattern 1: Discriminated Union Matching

```typescript
export type PermissionError = DeniedError | RejectedError

function handlePermissionError(err: PermissionError) {
  if (err instanceof DeniedError) {
    log.warn("User denied by rules", { ruleset: err.ruleset })
    return "Access denied by policy"
  }
  
  if (err instanceof RejectedError) {
    log.info("User rejected single action")
    return "Action cancelled"
  }
}
```

### Pattern 2: Effect-Based Error Mapping

```typescript
const mapPermissionError = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, PermissionError, R> =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof PermissionError 
        ? cause 
        : new DeniedError({ ruleset: {} }),
    ),
  )
```

### Pattern 3: Never Swallow Errors

```typescript
// BAD: Silent failure
try {
  await operation()
} catch {
  // Silently ignoring - BUG!
}

// GOOD: Log and re-throw or convert
try {
  await operation()
} catch (err) {
  log.error("Operation failed", { cause: err })
  throw new OperationError({ message: String(err), cause: err })
}
```

### Pattern 4: Try-Catch to Effect.tryPromise

```typescript
// OLD: Promise-based
async function getAccount(id: AccountID): Promise<Account> {
  try {
    const result = await db.select().from(AccountTable).where(eq(...))
    return result[0]
  } catch (err) {
    throw new AccountError({ message: "Failed to fetch", cause: err })
  }
}

// BETTER: Effect-based
const getAccount = (id: AccountID) =>
  Effect.tryPromise({
    try: async () => {
      const result = await db.select().from(AccountTable).where(eq(...))
      return result[0]
    },
    catch: (err) => new AccountError({ message: "Failed to fetch", cause: err }),
  })
```

---

## Common Error Patterns in OpenCode

### Permission Errors

```typescript
// Always these three possible outcomes:
if (ruleset.action === "deny") {
  throw new DeniedError({ ruleset })
}

if (userReply === "reject") {
  throw new RejectedError({})
}

if (userFeedback) {
  throw new CorrectedError({ feedback: userFeedback })
}
```

### API Errors (from Provider)

```typescript
export type ProviderAPIError = 
  | AuthError  // Provider auth failed
  | APIError  // Provider API returned error
  | ContextOverflowError  // Too many tokens

// In tool that calls LLM:
try {
  const result = await provider.call(...)
} catch (err) {
  if (isContextOverflow(err)) {
    throw new ContextOverflowError({ message: err.message })
  }
  if (isAuthError(err)) {
    throw new AuthError({ providerID: provider.id, message: err.message })
  }
  throw new APIError({ message: err.message, isRetryable: isRetryable(err) })
}
```

### Validation Errors

```typescript
// Zod validation at boundaries
const result = z.object({
  id: SessionID.zod,
  title: z.string(),
}).parse(input)

// If parse fails, returns detailed error with path info
// API routes should return 400 with validation details
```

---

## HTTP Status Mapping

```typescript
// Error → HTTP Status mapping:
RejectedError → 400 Bad Request (user action)
DeniedError → 403 Forbidden (policy)
ValidationError → 400 Bad Request
NotFoundError → 404 Not Found
AuthError → 401 Unauthorized
ServerError → 500 Internal Server Error
```

---

## Error Messages Best Practices

### ✅ GOOD Error Messages

```typescript
"User rejected permission to execute 'bash' on '/src/deploy.sh'"
// Clear about what happened, what permission, what resource

"Command failed with code 127: /bin/nonexistent\nnot found"
// Includes command, exit code, actual stderr output

"Context window exceeded: Used 50,000 / 10,000 tokens"
// Specific numbers so user understands

"Invalid email format: 'not-an-email'"
// Clear about validation failure and actual value
```

### ❌ POOR Error Messages

```typescript
"Error"  // What error?
"Failed"  // What failed?
"Something went wrong"  // Too vague
new Error()  // No message at all
```

---

## Testing Error Paths

```typescript
// Always test both success and error paths
describe("Tool execution", () => {
  it("should execute tool on success", async () => {
    const result = await tool.execute({ ...}, ctx)
    expect(result).toBeDefined()
  })

  it("should throw RejectedError when user denies", async () => {
    ctx.ask = async () => "reject"
    expect(() => tool.execute({...}, ctx))
      .rejects.toThrow(RejectedError)
  })

  it("should throw DeniedError when rule denies", async () => {
    // Set up ruleset that denies this pattern
    expect(() => tool.execute({...}, ctx))
      .rejects.toThrow(DeniedError)
  })
})
```

---

## Error Handling Checklist

When implementing error handling:
- [ ] All errors are named classes (not strings)
- [ ] Domain errors use Schema.TaggedErrorClass
- [ ] Error types form discriminated unions
- [ ] Never silently catch without re-throwing or converting
- [ ] Log all unexpected errors
- [ ] Validation errors include details
- [ ] Error messages are specific and actionable
- [ ] HTTP status codes map correctly
- [ ] Error paths are tested
