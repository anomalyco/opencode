import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261122120000_session-cwd",
  up(tx) {
    return tx.run(`ALTER TABLE \`session_v2\` ADD \`cwd\` text;`)
  },
}

export default migration
