# Transaction Consistency Guide

> **Purpose**: Ensure data consistency when writing to multiple tables or when data flows through multiple paths.

---

## Why This Guide?

In applications with multiple data paths, data can become inconsistent:

```
Write Operation -> Database Write -> Event Emission -> UI Update
```

**Each path may use different data formats**. If formats don't match:

- Parsing failures
- Data loss
- Display anomalies (e.g., "Untitled", wrong dates)

---

## Quick Reference: When to Use This Guide

### Trigger Symptoms

- [ ] Data written successfully, but UI doesn't show it
- [ ] UI shows "(Untitled)" or other default values
- [ ] Timestamp fields show anomalies (NaN, Invalid Date)
- [ ] Same record shows different values in different places

### Trigger Patterns

- [ ] Modified database write logic
- [ ] Modified event emission logic
- [ ] Changed timestamp handling functions
- [ ] Introduced new ORM type conversions

---

## The Two-Path Trap

### Understanding Multiple Data Paths

When you write data, there may be **two independent data paths**:

```
                    +----------------------------------+
                    |           Your Code              |
                    |   const timestamp = Date.now();  |
                    +----------------+-----------------+
                                     |
              +----------------------+----------------------+
              |                                             |
              v                                             v
    +---------------------+                   +---------------------+
    |   Path 1: DB Write  |                   |  Path 2: Event      |
    |                     |                   |                     |
    |  db.insert({        |                   |  emit('created', {  |
    |    createdAt: ?     |                   |    createdAt: ?     |
    |  })                 |                   |  })                 |
    +----------+----------+                   +----------+----------+
               |                                         |
               v                                         v
    +---------------------+                   +---------------------+
    |      Database       |                   |   Event Listeners   |
    |   createdAt: INT    |                   |   (update UI, etc)  |
    +---------------------+                   +---------------------+
```

**Problem**: These two paths may use different data formats!

---

## Debugging Methodology

### Step 1: Confirm Which Path Has Issues

| Symptom                             | Likely Problem Path     |
| ----------------------------------- | ----------------------- |
| Database query returns correct data | Path 2 (events/UI)      |
| Database query returns wrong data   | Path 1 (DB write)       |
| Event payload format is correct     | UI parsing              |
| Event payload format is wrong       | Path 2 (event emission) |

### Step 2: Check Event/Message Payloads

Log the actual data being passed:

```typescript
console.log('Event payload:', JSON.stringify(payload, null, 2));
```

Look for format issues:

```json
// Wrong: ISO string
{"createdAt": "2025-12-19T15:12:45.499Z"}

// Wrong: SQLite text format
{"createdAt": "2025-12-19 15:12:45"}

// Correct: Unix milliseconds
{"createdAt": 1766157165000}
```

### Step 3: Compare Database Stored Values

```sql
SELECT id, createdAt, typeof(createdAt) FROM entity ORDER BY createdAt DESC LIMIT 5;
```

```
ID           CREATEDAT        TYPEOF(CREATEDAT)
abc123       1766157165000    integer           -- Correct
def456       2025-12-19...    text              -- Wrong!
```

---

## Common Root Causes

### Cause 1: ORM Type Conversion Bugs

**Problem**: Some ORMs have bugs with timestamp handling.

```typescript
// May trigger ORM bug
await db.insert(entity).values({
  createdAt: new Date(), // ORM may write as "2025-12-19 15:00:00"
});
```

**Solution**: Use explicit timestamp values:

```typescript
// Bypass ORM type conversion
await db.insert(entity).values({
  createdAt: Date.now(), // Explicit milliseconds
});
```

### Cause 2: Event Payload Doesn't Match DB Format

**Problem**: Database write uses one format, events use another.

```typescript
// Format inconsistency
const now = new Date();

// Database: Unix milliseconds
await db.insert(entity).values({
  createdAt: Date.now(),
});

// Event: ISO string - WRONG!
emit('entity:created', {
  createdAt: now.toISOString(),
});
```

**Solution**: Use same timestamp value for both:

```typescript
const nowMs = Date.now();

// Database: Unix milliseconds
await db.insert(entity).values({
  createdAt: nowMs,
});

// Event: Also Unix milliseconds
emit('entity:created', {
  createdAt: nowMs,
});
```

### Cause 3: JSON.stringify Date Conversion

**Problem**: `JSON.stringify(Date)` converts to ISO string.

```typescript
const data = {
  createdAt: new Date(),
};
JSON.stringify(data); // {"createdAt":"2025-12-19T15:12:45.499Z"}
```

**Solution**: Convert dates before serialization:

```typescript
const data = {
  createdAt: Date.now(),
};
JSON.stringify(data); // {"createdAt":1766157165000}
```

---

## Prevention Checklist

When writing code that involves multi-table writes or events:

- [ ] **Database write format** - is it the expected format? (Unix ms)
- [ ] **Event payload format** - does it use the same format?
- [ ] **Timestamp variable naming** - is format clear? (`timestampMs` vs `timestampISO`)
- [ ] **ORM behavior** - any known bugs? Need workarounds?
- [ ] **JSON.stringify** - will it change data types?

---

## Data Format Reference

### Recommended Timestamp Format

| Location     | Format            | Example          |
| ------------ | ----------------- | ---------------- |
| Database     | Unix ms (integer) | `1766157165000`  |
| IPC Messages | Unix ms (number)  | `1766157165000`  |
| Events       | Unix ms (number)  | `1766157165000`  |
| UI Display   | Formatted string  | `"Dec 19, 2025"` |

**Principle**: Numbers everywhere except final display.

---

## Code Patterns

### Pattern 1: Unified Timestamp Utility

```typescript
// utils/timestamp.ts

export function nowMs(): number {
  return Date.now();
}

export function toUnixMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime();
  throw new Error(`Cannot convert to timestamp: ${value}`);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}
```

### Pattern 2: Consistent Multi-Path Write

```typescript
import { nowMs } from './utils/timestamp';

async function createEntity(title: string) {
  const entityId = generateId();
  const timestamp = nowMs();

  // 1. Prepare data (single source of truth)
  const entityData = {
    id: entityId,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // 2. Write to database
  await db.insert(entity).values(entityData);

  // 3. Emit event (use same data)
  emit('entity:created', entityData);

  return entityData;
}
```

### Pattern 3: Type-Safe Event Payloads

```typescript
// Define event payload types
interface EntityCreatedEvent {
  id: string;
  title: string;
  createdAt: number; // Unix ms - type makes format explicit
  updatedAt: number;
}

// Type-checked emission
function emitEntityCreated(data: EntityCreatedEvent) {
  emit('entity:created', data);
}

// Usage
emitEntityCreated({
  id: entityId,
  title: 'New Entity',
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
```

---

## Lessons Learned

### Case: Data Written But Not Showing

**Symptoms**:

- Documents created successfully
- Sometimes shows "(Untitled)"

**Debug Process**:

1. Check database -> data exists and correct
2. Check event payload -> timestamp was ISO string
3. Compare client expectation -> expects Unix ms

**Root Cause**:

- Database write used `Date.now()` -> Unix ms OK
- Event payload used `now.toISOString()` -> ISO string WRONG

**Fix**:

```typescript
// Before
const entityData = { createdAt: now.toISOString() };

// After
const entityData = { createdAt: Date.now() };
```

**Lessons**:

1. Database write and events are two independent paths, must check both
2. Variable naming should indicate format (`timestampMs` vs `timestampISO`)
3. ORMs may have bugs, don't assume they "just work"

### Case: ID Ordering Issues

**Symptoms**:

- Data exists but some items not showing
- Items appear in wrong order

**Root Cause**:

- Mixed ID formats (UUID, cuid, sequential)
- Sorting depends on ID string comparison
- Different formats sort incorrectly together

**Fix**:

Use consistent, time-ordered IDs:

```typescript
// Use UUIDv7 for time-ordered IDs
import { uuidv7 } from 'uuidv7';

const id = uuidv7(); // Time-ordered, sortable
```

**Lessons**:

1. IDs used for sorting must be consistently formatted
2. Mixing ID formats causes hard-to-debug issues
3. Document ID generation rules explicitly

---

## Transaction Patterns

### Pattern: Atomic Multi-Table Write

```typescript
async function createEntityWithRelations(data: CreateEntityInput) {
  return db.transaction(async (tx) => {
    const timestamp = Date.now();

    // 1. Create main entity
    const entity = await tx
      .insert(entities)
      .values({
        id: generateId(),
        ...data,
        createdAt: timestamp,
      })
      .returning();

    // 2. Create related records
    await tx.insert(relations).values({
      entityId: entity[0].id,
      createdAt: timestamp,
    });

    // 3. Return for event emission
    return entity[0];
  });
}

// After transaction succeeds, emit event
const entity = await createEntityWithRelations(data);
emit('entity:created', entity);
```

### Pattern: Rollback on Failure

```typescript
async function createWithRollback(data: CreateInput) {
  const timestamp = Date.now();

  try {
    await db.transaction(async (tx) => {
      // All writes in transaction
      await tx.insert(tableA).values({ ...data, createdAt: timestamp });
      await tx.insert(tableB).values({ ...data, createdAt: timestamp });
    });

    // Only emit after successful transaction
    emit('created', { ...data, createdAt: timestamp });
  } catch (error) {
    // Transaction automatically rolled back
    emit('createFailed', { error: error.message });
    throw error;
  }
}
```

---

## Quick Reference

### Debugging Steps

```
1. Check database - is data correct?
2. Check event/IPC payload - is format correct?
3. Check UI parsing - is it expecting correct format?
4. Compare formats - do all paths match?
```

### Format Validation

```typescript
// Quick format check
function validateTimestamp(value: unknown): number {
  if (typeof value !== 'number') {
    console.warn(`Expected number timestamp, got ${typeof value}:`, value);
  }
  return toUnixMs(value);
}
```

---

**Core Principle**: Multiple data paths, consistent format. Validate at every boundary.

---

**Language**: All documentation should be written in **English**.
