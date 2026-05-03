#!/usr/bin/env bun
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { getPool } from "./db.pg"

export async function runPostgresMigrations() {
  const pool = getPool()
  const migrationDir = resolve(import.meta.dir, "../../migration")

  // Get all migration folders sorted by timestamp
  const entries = readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  if (entries.length === 0) {
    console.log("No migrations found")
    return
  }

  // Create drizzle __drizzle_migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Get already applied migrations
  const { rows: applied } = await pool.query('SELECT hash FROM "__drizzle_migrations"')
  const appliedHashes = new Set(applied.map((r: { hash: string }) => r.hash))

  for (const entry of entries) {
    if (appliedHashes.has(entry)) {
      console.log(`Skipping already applied migration: ${entry}`)
      continue
    }

    const sqlPath = resolve(migrationDir, entry, "migration.sql")
    let sql: string
    try {
      sql = readFileSync(sqlPath, "utf8")
    } catch {
      console.warn(`No migration.sql found in ${entry}, skipping`)
      continue
    }

    // Split and execute each statement
    const statements = sql
      .split(";--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)

    console.log(`Applying migration: ${entry} (${statements.length} statements)`)

    for (const statement of statements) {
      if (!statement) continue
      await pool.query(statement + ";")
    }

    // Record as applied
    await pool.query('INSERT INTO "__drizzle_migrations" (hash) VALUES ($1)', [entry])
  }

  console.log("PostgreSQL migrations completed successfully")
}

// Initialize pool and run
import { Database } from "./db.pg"
await Database.initialize()
await runPostgresMigrations()
process.exit(0)
