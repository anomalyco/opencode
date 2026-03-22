#!/usr/bin/env bun
/**
 * List OpenCode sessions either from a live server or directly from SQLite.
 */

import { Database } from "bun:sqlite"
import { parseArgs } from "util"
import { json, pub, resolve } from "./server"

interface Args {
  DB_PATH: string
  LIMIT: number
  DIRECTORY?: string
  SESSION_ID?: string
  INCLUDE_LAST_TEXT: boolean
  PORT?: number
  USERNAME?: string
  PASSWORD?: string
  PREFER_DESKTOP: boolean
  SOURCE: "auto" | "server" | "db"
}

function defaultDbPath() {
  const home = process.env.HOME || "~"
  return `${home}/.local/share/opencode/opencode.db`
}

function normalizeText(text: string, max = 220) {
  const one = text.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function extractTextFromMessageData(dataText: string): string {
  try {
    const data = JSON.parse(dataText)
    if (typeof data?.text === "string" && data.text.trim()) return data.text.trim()
    const parts = Array.isArray(data?.parts) ? data.parts : []
    return parts
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim()
  } catch {
    return ""
  }
}

function openDb(file: string) {
  return new Database(file, { readonly: true })
}

function listDb(args: Args) {
  const db = openDb(args.DB_PATH)
  const where = [] as string[]
  const values = [] as any[]
  if (args.DIRECTORY) {
    where.push("directory = ?")
    values.push(args.DIRECTORY)
  }
  if (args.SESSION_ID) {
    where.push("id = ?")
    values.push(args.SESSION_ID)
  }
  const sql = `
    SELECT id, title, directory, workspace_id, parent_id, time_created, time_updated
    FROM session
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY time_updated DESC
    LIMIT ?
  `
  values.push(args.LIMIT)
  const rows = db.query(sql).all(...values) as any[]
  const sessions = args.INCLUDE_LAST_TEXT
    ? rows.map((session) => {
        const row = db
          .query(
            `
            SELECT data
            FROM message
            WHERE session_id = ?
            ORDER BY time_created DESC
            LIMIT 20
          `,
          )
          .all(session.id)
          .map((item: any) => item.data)
          .find((item: string) => {
            try {
              return JSON.parse(item)?.role === "assistant"
            } catch {
              return false
            }
          })
        const text = row ? extractTextFromMessageData(row) : ""
        return {
          id: session.id,
          title: session.title,
          directory: session.directory,
          workspace_id: session.workspace_id,
          parent_id: session.parent_id,
          time_created: session.time_created,
          time_updated: session.time_updated,
          created_local: new Date(session.time_created).toISOString(),
          updated_local: new Date(session.time_updated).toISOString(),
          last_text: text,
          last_text_preview: text ? normalizeText(text) : "",
        }
      })
    : rows.map((session) => ({
        id: session.id,
        title: session.title,
        directory: session.directory,
        workspace_id: session.workspace_id,
        parent_id: session.parent_id,
        time_created: session.time_created,
        time_updated: session.time_updated,
        created_local: new Date(session.time_created).toISOString(),
        updated_local: new Date(session.time_updated).toISOString(),
      }))
  return {
    success: true,
    source: "db",
    db_path: args.DB_PATH,
    sessions,
  }
}

async function listServer(args: Args) {
  const target = await resolve({
    port: args.PORT,
    username: args.USERNAME,
    password: args.PASSWORD,
    preferDesktop: args.PREFER_DESKTOP,
    sessionID: args.SESSION_ID,
  })
  const query = new URLSearchParams()
  query.set("limit", String(args.LIMIT))
  if (args.DIRECTORY) query.set("directory", args.DIRECTORY)
  const sessions = await json<any[]>(target, `/session?${query.toString()}`)
  const filtered = sessions.filter((session) => !args.SESSION_ID || session.id === args.SESSION_ID)
  return {
    success: true,
    source: "server",
    server: pub(target),
    sessions: filtered,
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    DB_PATH: { type: "string", default: defaultDbPath() },
    LIMIT: { type: "string", default: "10" },
    DIRECTORY: { type: "string" },
    SESSION_ID: { type: "string" },
    INCLUDE_LAST_TEXT: { type: "boolean", default: false },
    PORT: { type: "string" },
    USERNAME: { type: "string" },
    PASSWORD: { type: "string" },
    PREFER_DESKTOP: { type: "boolean", default: true },
    SOURCE: { type: "string", default: "auto" },
    help: { type: "boolean", short: "h" },
  },
})

if (values.help) {
  console.error(
    "Usage: bun run scripts/opencode_sessions.ts [--LIMIT 10] [--DIRECTORY /path] [--SESSION_ID ses_xxx] [--INCLUDE_LAST_TEXT] [--SOURCE auto|server|db] [--PORT 4098] [--DB_PATH /path/to/opencode.db]",
  )
  process.exit(0)
}

const args: Args = {
  DB_PATH: values.DB_PATH,
  LIMIT: parseInt(values.LIMIT || "10", 10),
  DIRECTORY: values.DIRECTORY,
  SESSION_ID: values.SESSION_ID,
  INCLUDE_LAST_TEXT: Boolean(values.INCLUDE_LAST_TEXT),
  PORT: values.PORT ? parseInt(values.PORT, 10) : undefined,
  USERNAME: values.USERNAME,
  PASSWORD: values.PASSWORD,
  PREFER_DESKTOP: values.PREFER_DESKTOP !== false,
  SOURCE: values.SOURCE === "server" || values.SOURCE === "db" ? values.SOURCE : "auto",
}

const result =
  args.SOURCE === "db"
    ? listDb(args)
    : await listServer(args).catch((error) => {
        if (args.SOURCE === "server") {
          return { success: false, error: error.message || String(error) }
        }
        return listDb(args)
      })

console.log(JSON.stringify(result, null, 2))
process.exit(result.success ? 0 : 1)
