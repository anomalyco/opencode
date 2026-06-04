# Transaction Helper Functions Silent Failure

> **Severity**: P1 - Data loss, sync failures

## Problem

Data appears to save successfully (no errors shown), but changes are lost or never sync to the server:

- User edits and saves - UI shows success
- User reopens - changes are gone
- Some records work, others don't
- No error messages anywhere

## Symptoms

- Intermittent save failures (some work, some don't)
- Data saved locally but never syncs
- No visible errors in UI
- Logs show validation errors but operation "succeeds"

## Root Cause

A helper function called inside a database transaction **returns silently on error** instead of throwing:

```typescript
// BAD: Silent return on validation failure
export function recordChangeInTransaction(tx: Transaction, input: ChangeInput): void {
  const parseResult = schema.safeParse(input);

  if (!parseResult.success) {
    logger.error('Invalid input', { error: parseResult.error });
    return; // <-- SILENT RETURN - Transaction continues!
  }

  // Record the change...
  tx.insert(pendingChanges).values(/* ... */).run();
}
```

### The Failure Chain

```
User clicks Save
    |
    v
saveDocument() starts transaction
    |
    +--> Update document data (succeeds)
    |
    +--> recordChangeInTransaction() (validation fails, returns silently)
    |
    v
Transaction commits (no error thrown)
    |
    v
UI shows "Saved!" (because no error)
    |
    v
Document data saved locally
BUT
Change not recorded for sync
    |
    v
Data never reaches server
```

## Why This Is Dangerous

1. **Partial success** - Main operation succeeds, side-effect fails
2. **No user feedback** - UI shows success
3. **Silent data loss** - Changes exist locally but won't sync
4. **Hard to debug** - Only visible in logs, not in behavior

## Solution

**Transaction helper functions must throw on failure:**

```typescript
// GOOD: Throw on validation failure
export function recordChangeInTransaction(tx: Transaction, input: ChangeInput): void {
  const parseResult = schema.safeParse(input);

  if (!parseResult.success) {
    // Throw error - transaction will rollback
    throw new Error(`Validation failed: ${parseResult.error.issues[0].message}`);
  }

  tx.insert(pendingChanges).values(/* ... */).run();
}
```

### The Correct Flow

```
User clicks Save
    |
    v
saveDocument() starts transaction
    |
    +--> Update document data (succeeds)
    |
    +--> recordChangeInTransaction() (validation fails, THROWS)
    |
    v
Transaction ROLLS BACK (error propagated)
    |
    v
saveDocument() catches error
    |
    v
UI shows "Save failed: [reason]"
    |
    v
User can fix issue and retry
```

## Alternative: Return Error Objects

If throwing isn't appropriate, return an error object and **require the caller to check it**:

```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };

export function recordChange(tx: Transaction, input: ChangeInput): Result<void> {
  const parseResult = schema.safeParse(input);

  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0].message,
    };
  }

  tx.insert(pendingChanges).values(/* ... */).run();
  return { success: true, data: undefined };
}

// Caller MUST check
function saveDocument(data: DocumentData) {
  db.transaction((tx) => {
    tx.update(documents).set(data).run();

    const result = recordChange(tx, buildChangePayload(data));
    if (!result.success) {
      throw new Error(result.error); // Trigger rollback
    }
  });
}
```

## Anti-Patterns to Avoid

### 1. Log and Return

```typescript
// BAD
if (error) {
  logger.error('Something failed', { error });
  return; // Transaction continues with partial state
}
```

### 2. Silent Catch

```typescript
// BAD
try {
  await riskyOperation();
} catch (e) {
  // Swallowed - caller never knows
}
```

### 3. Optional Side Effects

```typescript
// BAD - Side effect should be required, not optional
function save(data: Data, recordSync = true) {
  tx.update(table).set(data).run();
  if (recordSync) {
    recordChange(tx, data); // If this fails silently, data won't sync
  }
}
```

## Key Insight

**Functions called inside transactions must either:**

1. **Throw on failure** - Transaction automatically rolls back
2. **Return error object** - Caller must check and decide to abort
3. **Document as optional** - Explicitly mark as "failure is acceptable"

**Never silently return** from a transaction helper when something goes wrong. The calling code has no way to know the operation failed.

## Detection Checklist

Review transaction code for:

- [ ] Helper functions that return `void` - do they throw on error?
- [ ] `safeParse()` calls - what happens when validation fails?
- [ ] `try/catch` blocks - are errors re-thrown or swallowed?
- [ ] Side-effect functions - do they report failures to caller?

## Prevention

### Code Review Focus

When reviewing transaction code:

```typescript
// Red flags to look for:
if (!valid) {
  logger.error(...);
  return;  // <-- Is this inside a transaction? Should it throw?
}
```

### TypeScript Pattern

Consider using a Result type that TypeScript forces you to handle:

```typescript
// Type that can't be ignored
type MustHandle<T> = { readonly _brand: unique symbol; value: T };

// Caller must explicitly access .value, forcing them to think about errors
```

### Testing

```typescript
it('should rollback on validation failure', () => {
  const invalidInput = {
    /* invalid */
  };

  expect(() => {
    db.transaction((tx) => {
      updateDocument(tx, validDoc);
      recordChange(tx, invalidInput); // Should throw
    });
  }).toThrow();

  // Verify document NOT updated (rollback worked)
  const doc = db.select().from(documents).get();
  expect(doc).toBeUndefined();
});
```
