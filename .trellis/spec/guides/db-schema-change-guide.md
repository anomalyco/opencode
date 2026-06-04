# Database Schema Change Thinking Guide

> **Purpose**: Ensure schema changes are fully deployed with data migration
>
> **Core Principle**: Schema change = Code change + Migration + Data cleanup

---

## Why This Guide?

Modifying database schema is not just about changing code. If you forget to migrate or clean up data:

- Code expects new format, database still has old format -> runtime errors
- New data uses new format, old data uses old format -> data inconsistency
- Type mismatch -> parsing failures, NaN, Invalid Date

---

## Schema Change Checklist

Every time you modify your database schema, complete these steps:

### 1. Code Changes

- [ ] Modify table definitions in schema file
- [ ] Update all code that reads/writes the field
- [ ] Update related type definitions (Zod schema, TypeScript types)
- [ ] Run `pnpm typecheck` to ensure type consistency

### 2. Generate Migration

```bash
# For Drizzle ORM
pnpm drizzle-kit generate

# For Prisma
npx prisma migrate dev --name migration_name
```

- [ ] Check generated SQL file is correct
- [ ] Note: ORM-generated migrations may have issues (e.g., dropping non-existent indexes)

### 3. Execute Migration

```bash
# For Drizzle ORM
pnpm drizzle-kit migrate

# For Prisma
npx prisma migrate deploy
```

- [ ] If migration fails, may need to execute SQL manually
- [ ] SQLite doesn't support `ALTER COLUMN`, need to rebuild table

### 4. Clean Up Dirty Data

- [ ] Check if existing data needs format conversion
- [ ] Write data migration SQL
- [ ] Execute and verify

### 5. Verify

```sql
-- Check data types
SELECT typeof(column_name), COUNT(*) FROM table_name GROUP BY typeof(column_name);

-- Check for abnormal values
SELECT * FROM table_name WHERE column_name IS NULL OR typeof(column_name) != 'expected_type';
```

- [ ] All data types correct
- [ ] No dirty data remaining

### 6. Deploy

- [ ] Commit code changes
- [ ] Deploy to production
- [ ] Verify production data again

---

## Timestamp Format Change: Full Output Checklist

Timestamp format changes (e.g., ISO -> Unix ms) are not just DB-level, **must check all output points**:

### Layers to Check

```
+-------------------------------------------------------+
|           Timestamp Format Change Checkpoints          |
+-------------------------------------------------------+
|                                                        |
|  1. Data Layer (DB Schema)                             |
|     [ ] schema file - table definitions                |
|     [ ] Execute data migration                         |
|     [ ] Verify existing data format                    |
|                                                        |
|  2. API/IPC Layer                                      |
|     [ ] IPC handlers - response format                 |
|     [ ] Check all toISOString() call sites             |
|                                                        |
|  3. UI Layer                                           |
|     [ ] Components that display timestamps             |
|     [ ] Forms that accept timestamp input              |
|                                                        |
|  4. Type Definition Layer                              |
|     [ ] Shared types - timestamp field types           |
|     [ ] Zod schemas if used                            |
|                                                        |
+-------------------------------------------------------+
```

### Search Commands

```bash
# Find all timestamp output points
rg "toISOString|createdAt|updatedAt" src/ --type ts

# Find Zod schema timestamp definitions
rg "z.string\(\)|z.number\(\)" src/shared/types/
```

### Common Mistakes

#### Mistake 1: Only Changed Some Layers

Problem: Changed timestamp from ISO -> Unix ms in:

- DB schema
- Some handlers
- But forgot other handlers

Result: Some responses return Unix ms, others return ISO strings.

Lesson: All related code must be checked together.

#### Mistake 2: JSON Fields Not Migrated

Problem: When changing timestamp format, only migrated table columns, forgot JSON fields inside also have timestamps:

```
table:
|-- createdAt (column)    -> Migrated
+-- data (JSON column)
    |-- $.createdAt       -> Forgot to migrate!
    |-- $.updatedAt       -> Forgot to migrate!
```

Result: Client parsing fails because JSON field timestamps still have old format.

Fix: Use JSON functions to migrate:

```sql
UPDATE table_name
SET json_column = json_set(
  json_column,
  '$.createdAt', CAST(strftime('%s', json_extract(json_column, '$.createdAt')) * 1000 AS INTEGER)
)
WHERE typeof(json_extract(json_column, '$.createdAt')) = 'text';
```

Lessons:

1. **JSON fields are not black boxes** - fields inside also need format consistency
2. **Data migration must check all levels** - table columns + JSON field internals
3. **Verification must cover JSON fields**:
   ```sql
   SELECT typeof(json_extract(data, '$.createdAt')), COUNT(*)
   FROM table_name GROUP BY 1;
   ```

#### Mistake 3: Serialization Still Outputs Old Format

Problem: Migrated old data, but new writes still output old format.

Root cause: Serialization function converts Date objects to ISO strings:

```typescript
// Before (wrong)
function serializeRow(row) {
  if (value instanceof Date) {
    result[key] = value.toISOString(); // <- Here!
  }
}
```

Fix: Output Unix ms instead:

```typescript
result[key] = value.getTime();
```

Lessons:

1. **Data migration does not equal problem solved** - migration only fixes old data, new data may still use old format
2. **Trace complete data flow** - check every layer's transformation from DB to final output
3. **Search all format conversion functions**:
   ```bash
   rg "toISOString|serialize" src/ --type ts
   ```

---

## JSON Field Data Migration Checklist

When modifying data format involves JSON fields, must additionally check:

- [ ] **Identify all JSON fields containing the format**

  ```sql
  -- Example: find all JSON fields containing timestamps
  SELECT json_extract(data, '$.createdAt') FROM table_name LIMIT 5;
  ```

- [ ] **Check data format inside JSON fields**

  ```sql
  SELECT typeof(json_extract(data, '$.fieldName')), COUNT(*)
  FROM table_name GROUP BY 1;
  ```

- [ ] **Write JSON field migration SQL**

  ```sql
  UPDATE table_name
  SET json_column = json_set(json_column, '$.fieldName', newValue)
  WHERE condition;
  ```

- [ ] **Verify migration results**

---

## SQLite Schema Change Patterns

### Pattern 1: Modify Column Type

SQLite doesn't support `ALTER COLUMN`, need to rebuild table:

```sql
-- 1. Create new table
CREATE TABLE table_new (
  id TEXT PRIMARY KEY,
  -- ... other columns
  column_name INTEGER NOT NULL  -- new type
);

-- 2. Migrate data (with type conversion)
INSERT INTO table_new (id, ..., column_name)
SELECT id, ..., CAST(column_name AS INTEGER)
FROM table_old;

-- 3. Replace table
DROP TABLE table_old;
ALTER TABLE table_new RENAME TO table_old;

-- 4. Rebuild indexes
CREATE INDEX ... ON table_old (...);
```

### Pattern 2: ISO String -> Unix Milliseconds

```sql
-- Check which need conversion
SELECT
  CASE
    WHEN strftime('%s', column_name) IS NOT NULL THEN 'ISO string'
    ELSE 'Already numeric'
  END as format,
  COUNT(*)
FROM table_name
GROUP BY format;

-- Conversion logic
CASE
  WHEN strftime('%s', column_name) IS NOT NULL
    THEN CAST(strftime('%s', column_name) AS INTEGER) * 1000  -- ISO -> Unix ms
  ELSE CAST(column_name AS INTEGER)  -- already numeric
END
```

### Pattern 3: Add Non-Null Column

```sql
-- 1. Add nullable column
ALTER TABLE table_name ADD COLUMN new_column TEXT;

-- 2. Fill default values
UPDATE table_name SET new_column = 'default_value' WHERE new_column IS NULL;

-- 3. If need NOT NULL constraint, rebuild table
```

---

## Common Pitfalls

### Pitfall 1: Only Changed Code Without Migration

```typescript
// schema changed
createdAt: integer('createdAt'); // changed from text to integer

// But database still has text!
// Result: new writes are integer, old data is text, chaos!
```

**Solution**: Always execute migration after schema changes

### Pitfall 2: ORM Migration Fails

ORM-generated migrations may try to drop non-existent indexes:

```sql
DROP INDEX "some_index";  -- Will error if doesn't exist
```

**Solution**: Check generated SQL, manually execute if needed

### Pitfall 3: Forgot to Clean Dirty Data

```sql
-- After migration
SELECT typeof(createdAt), COUNT(*) FROM table_name GROUP BY typeof(createdAt);

-- Result
-- text     2900   <- old data!
-- integer  10     <- new data
```

**Solution**: Always verify data types after migration

### Pitfall 4: Production Data Different from Dev

Development environment may not have old format data, but production does.

**Solution**:

1. Check data format in production first
2. Write migration script that handles multiple formats
3. Verify after migration

---

## Quick Reference

### Migration Commands

```bash
# Drizzle ORM
pnpm drizzle-kit generate  # Generate migration
pnpm drizzle-kit migrate   # Execute migration
pnpm drizzle-kit push      # Direct push (dev only)
pnpm drizzle-kit studio    # View database

# Prisma
npx prisma migrate dev     # Dev migration
npx prisma migrate deploy  # Production migration
npx prisma studio          # View database
```

### Verification SQL

```sql
-- Check column types
PRAGMA table_info(table_name);

-- Check data type distribution
SELECT typeof(column_name), COUNT(*) FROM table_name GROUP BY typeof(column_name);

-- Check abnormal values
SELECT * FROM table_name WHERE typeof(column_name) != 'integer' LIMIT 10;
```

---

**Core Principle**: Database schema change = code + migration + data cleanup + verification. None can be skipped.
