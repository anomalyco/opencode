# opencode

Dylan's fork of opencode-ai with custom fixes and enhancements.

## Database Schema Changes

**CRITICAL: After ANY change to `*.sql.ts` files, you MUST run:**
```bash
cd packages/opencode && bun drizzle-kit generate
```
**Then commit the generated migration file alongside the schema change.**

Failure to do this causes runtime crashes on server restart - the Drizzle ORM schema references columns that don't exist in the actual SQLite database. This is not caught by TypeScript compilation or type checking.

**Enforcement:** The pre-commit hook will block commits that modify `*.sql.ts` files without also staging migration files in `packages/opencode/migration/`.
