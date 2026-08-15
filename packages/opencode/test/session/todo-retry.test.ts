import { expect, test } from "bun:test"
import { Cause } from "effect"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { isRetryableSqlError } from "../../src/session/todo"

function sqliteError(code: string): Error {
  const err = new Error(`SQLite error: ${code}`) as Error & { code: string }
  err.code = code
  return err
}

function sqlErrorFor(code: string): SqlError {
  return new SqlError({
    reason: classifySqliteError(sqliteError(code), { message: "Failed to execute statement", operation: "execute" }),
  })
}

test("isRetryableSqlError detects SQLITE_BUSY through the drizzle error wrapper", () => {
  const sqlError = sqlErrorFor("SQLITE_BUSY")
  // Simulate drizzle's EffectDrizzleQueryError whose cause is Cause<SqlError>.
  const wrapped = new Error("Failed query") as Error & { cause: unknown }
  wrapped.cause = Cause.fail(sqlError)

  expect(isRetryableSqlError(Cause.fail(wrapped))).toBe(true)
})

test("isRetryableSqlError detects SQLITE_BUSY directly on a SqlError cause", () => {
  expect(isRetryableSqlError(Cause.fail(sqlErrorFor("SQLITE_BUSY")))).toBe(true)
})

test("isRetryableSqlError returns false for non-retryable SQL errors", () => {
  expect(isRetryableSqlError(Cause.fail(sqlErrorFor("SQLITE_CONSTRAINT_UNIQUE")))).toBe(false)
})

test("isRetryableSqlError returns false for unrelated errors", () => {
  expect(isRetryableSqlError(Cause.fail(new Error("boom")))).toBe(false)
})
