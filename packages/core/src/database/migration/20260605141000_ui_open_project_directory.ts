import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260605141000_ui_open_project_directory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`ui_open_project\` ADD COLUMN \`directory\` text;`)
      yield* tx.run(`ALTER TABLE \`ui_project_view_last_project\` ADD COLUMN \`directory\` text;`)
      yield* tx.run(`
        UPDATE \`ui_open_project\`
        SET \`directory\` = (
          SELECT \`project\`.\`worktree\`
          FROM \`project\`
          WHERE \`project\`.\`id\` = \`ui_open_project\`.\`project_id\`
        )
        WHERE \`directory\` IS NULL;
      `)
      yield* tx.run(`
        UPDATE \`ui_project_view_last_project\`
        SET \`directory\` = (
          SELECT \`project\`.\`worktree\`
          FROM \`project\`
          WHERE \`project\`.\`id\` = \`ui_project_view_last_project\`.\`project_id\`
        )
        WHERE \`directory\` IS NULL;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
