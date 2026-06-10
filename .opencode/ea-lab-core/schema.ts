import { Database } from "bun:sqlite"

const EA_LAB_SCHEMA_VERSION = "1"

export function ensureEaLabSchema(db: Database) {
  db.exec("pragma journal_mode = wal")
  db.exec("pragma synchronous = normal")
  db.exec("pragma busy_timeout = 5000")
  db.exec(`
    create table if not exists ea_lab_meta (
      key text primary key,
      value text not null,
      updated_at integer not null
    );
  `)
  upsertEaLabMeta(db, "ea_lab_schema_version", EA_LAB_SCHEMA_VERSION)
}

export function upsertEaLabMeta(db: Database, key: string, value: string) {
  db.query(
    "insert into ea_lab_meta (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Date.now())
}

export function readEaLabMeta(db: Database, key: string) {
  return db.query<{ value: string }, [string]>("select value from ea_lab_meta where key = ? limit 1").get(key)?.value
}
