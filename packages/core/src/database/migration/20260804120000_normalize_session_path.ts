import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260804120000_normalize_session_path",
  up(tx) {
    return Effect.gen(function* () {
      // Sessions created on Windows in non-git projects (worktree "/")
      // stored an absolute path because `path.resolve("/")` resolves to the
      // current process drive root. Those paths can never match the
      // worktree-relative path used by the session list query, which hides
      // the sessions from the picker. NULL them so the list query's
      // directory-based fallback (`path IS NULL AND directory = ?`) matches
      // them again. Empty paths from older migrations have the same problem.
      yield* tx.run(
        `UPDATE \`session\` SET \`path\` = NULL WHERE \`path\` = '' OR \`path\` LIKE '/%' OR \`path\` LIKE '_:/%'`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
