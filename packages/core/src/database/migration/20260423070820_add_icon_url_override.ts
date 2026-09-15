import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260423070820_add_icon_url_override",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        ALTER TABLE \`project\` ADD \`icon_url_override\` text;
        UPDATE \`project\` SET \`icon_url_override\` = \`icon_url\` WHERE \`icon_url\` IS NOT NULL;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
