import { Database as BunDatabase } from "bun:sqlite"
import path from "path"
import { Flag } from "@/flag/flag"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Embed } from "./embed"

export namespace Cache {
  export interface ToolRow {
    id: string
    name: string
    description: string
    schema_json: string
    embedding?: Float32Array
    embed_model?: string
    content_hash?: string
    is_l1: number
    use_count: number
    last_used?: number
    registered: number
  }

  export interface SkillRow {
    id: string
    name: string
    description: string
    location: string
    embedding?: Float32Array
    embed_model?: string
    content_hash?: string
    is_l1: number
    use_count: number
    last_used?: number
    registered: number
  }

  const state = {
    db: undefined as BunDatabase | undefined,
    tools: new Map<string, ToolRow>(),
    skills: new Map<string, SkillRow>(),
    initialized: false,
  }

  const defaults = {
    maxTools: 20,
    maxSkills: 20,
  }

  function bytes(input: Float32Array) {
    const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    return Uint8Array.from(view)
  }

  function vector(input: unknown) {
    if (!input) return undefined
    const blob = input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBuffer)
    const copy = Uint8Array.from(blob)
    return new Float32Array(copy.buffer)
  }

  function now() {
    return Date.now()
  }

  async function cfg() {
    const config = await Config.get()
    const cache = config.experimental?.cache
    return {
      maxTools: cache?.maxTools ?? defaults.maxTools,
      maxSkills: cache?.maxSkills ?? defaults.maxSkills,
      embedModel: cache?.embedModel,
    }
  }

  function table() {
    if (!state.db) return

    state.db.run(`
      CREATE TABLE IF NOT EXISTS tool_cache (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        embedding BLOB,
        embed_model TEXT,
        content_hash TEXT,
        is_l1 INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used INTEGER,
        registered INTEGER NOT NULL
      );
    `)

    state.db.run(`
      CREATE TABLE IF NOT EXISTS skill_cache (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        embedding BLOB,
        embed_model TEXT,
        content_hash TEXT,
        is_l1 INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used INTEGER,
        registered INTEGER NOT NULL
      );
    `)
  }

  function loadTools() {
    if (!state.db) return
    const rows = state.db
      .query(
        `SELECT id, name, description, schema_json, embedding, embed_model, content_hash, is_l1, use_count, last_used, registered FROM tool_cache`,
      )
      .all() as any[]

    state.tools = new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          description: row.description,
          schema_json: row.schema_json,
          embedding: vector(row.embedding),
          embed_model: row.embed_model ?? undefined,
          content_hash: row.content_hash ?? undefined,
          is_l1: Number(row.is_l1 ?? 0),
          use_count: Number(row.use_count ?? 0),
          last_used: row.last_used ? Number(row.last_used) : undefined,
          registered: Number(row.registered ?? 0),
        } satisfies ToolRow,
      ]),
    )
  }

  function loadSkills() {
    if (!state.db) return
    const rows = state.db
      .query(
        `SELECT id, name, description, location, embedding, embed_model, content_hash, is_l1, use_count, last_used, registered FROM skill_cache`,
      )
      .all() as any[]

    state.skills = new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          description: row.description,
          location: row.location,
          embedding: vector(row.embedding),
          embed_model: row.embed_model ?? undefined,
          content_hash: row.content_hash ?? undefined,
          is_l1: Number(row.is_l1 ?? 0),
          use_count: Number(row.use_count ?? 0),
          last_used: row.last_used ? Number(row.last_used) : undefined,
          registered: Number(row.registered ?? 0),
        } satisfies SkillRow,
      ]),
    )
  }

  async function ensure() {
    if (state.initialized) return
    if (!(await isEnabled())) return

    state.db = new BunDatabase(path.join(Global.Path.data, "cache.db"), { create: true })
    state.db.run("PRAGMA journal_mode = WAL")
    table()
    loadTools()
    loadSkills()
    state.initialized = true
  }

  async function toolLimit() {
    return (await cfg()).maxTools
  }

  async function skillLimit() {
    return (await cfg()).maxSkills
  }

  async function enforceToolLimit(active: string) {
    if (!state.db) return
    const max = await toolLimit()
    const l1 = [...state.tools.values()].filter((row) => row.is_l1 === 1)
    if (l1.length <= max) return

    const victim = l1
      .filter((row) => row.id !== active)
      .sort((a, b) => (a.last_used ?? a.registered) - (b.last_used ?? b.registered))[0]

    if (!victim) return
    state.db.query(`UPDATE tool_cache SET is_l1 = 0 WHERE id = ?`).run(victim.id)
    loadTools()
  }

  async function enforceSkillLimit(active: string) {
    if (!state.db) return
    const max = await skillLimit()
    const l1 = [...state.skills.values()].filter((row) => row.is_l1 === 1)
    if (l1.length <= max) return

    const victim = l1
      .filter((row) => row.id !== active)
      .sort((a, b) => (a.last_used ?? a.registered) - (b.last_used ?? b.registered))[0]

    if (!victim) return
    state.db.query(`UPDATE skill_cache SET is_l1 = 0 WHERE id = ?`).run(victim.id)
    loadSkills()
  }

  export async function isEnabled() {
    if (Flag.OPENCODE_EXPERIMENTAL_CACHE) return true
    const config = await Config.get()
    return config.experimental?.cache?.enabled === true
  }

  export async function init() {
    if (!(await isEnabled())) return
    await ensure()
  }

  export async function l1Tools() {
    await ensure()
    return new Set([...state.tools.values()].filter((row) => row.is_l1 === 1).map((row) => row.id))
  }

  export async function l1Skills() {
    await ensure()
    return new Set([...state.skills.values()].filter((row) => row.is_l1 === 1).map((row) => row.name))
  }

  export async function l2Tools() {
    await ensure()
    return new Set([...state.tools.values()].filter((row) => row.is_l1 === 0).map((row) => row.id))
  }

  export async function l2Skills() {
    await ensure()
    return new Set([...state.skills.values()].filter((row) => row.is_l1 === 0).map((row) => row.name))
  }

  export async function l2ToolRows() {
    await ensure()
    return [...state.tools.values()].filter((row) => row.is_l1 === 0)
  }

  export async function l2SkillRows() {
    await ensure()
    return [...state.skills.values()].filter((row) => row.is_l1 === 0)
  }

  export async function allToolRows() {
    await ensure()
    return [...state.tools.values()]
  }

  export async function allSkillRows() {
    await ensure()
    return [...state.skills.values()]
  }

  export async function registerTool(input: { id: string; name: string; description: string; schema_json: string }) {
    await ensure()
    if (!state.db) return

    const existing = state.tools.get(input.id)
    const content = Embed.forTool(input)
    const content_hash = Embed.hash(content)
    const embedded =
      existing?.content_hash === content_hash ? existing.embedding : (await Embed.generate([content])).at(0)

    const conf = await cfg()
    state.db
      .query(
        `INSERT INTO tool_cache (id, name, description, schema_json, embedding, embed_model, content_hash, is_l1, use_count, last_used, registered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           schema_json=excluded.schema_json,
           embedding=excluded.embedding,
           embed_model=excluded.embed_model,
           content_hash=excluded.content_hash`,
      )
      .run(
        input.id,
        input.name,
        input.description,
        input.schema_json,
        embedded ? bytes(embedded) : null,
        conf.embedModel ?? null,
        content_hash,
        existing?.is_l1 ?? 0,
        existing?.use_count ?? 0,
        existing?.last_used ?? null,
        existing?.registered ?? now(),
      )

    loadTools()
  }

  export async function registerSkill(input: { name: string; description: string; location: string }) {
    await ensure()
    if (!state.db) return

    const existing = state.skills.get(input.name)
    const content = Embed.forSkill(input)
    const content_hash = Embed.hash(content)
    const embedded =
      existing?.content_hash === content_hash ? existing.embedding : (await Embed.generate([content])).at(0)

    const conf = await cfg()
    state.db
      .query(
        `INSERT INTO skill_cache (id, name, description, location, embedding, embed_model, content_hash, is_l1, use_count, last_used, registered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           location=excluded.location,
           embedding=excluded.embedding,
           embed_model=excluded.embed_model,
           content_hash=excluded.content_hash`,
      )
      .run(
        input.name,
        input.name,
        input.description,
        input.location,
        embedded ? bytes(embedded) : null,
        conf.embedModel ?? null,
        content_hash,
        existing?.is_l1 ?? 0,
        existing?.use_count ?? 0,
        existing?.last_used ?? null,
        existing?.registered ?? now(),
      )

    loadSkills()
  }

  export async function unregisterTool(id: string) {
    await ensure()
    if (!state.db) return
    state.db.query(`DELETE FROM tool_cache WHERE id = ?`).run(id)
    loadTools()
  }

  export async function unregisterSkill(name: string) {
    await ensure()
    if (!state.db) return
    state.db.query(`DELETE FROM skill_cache WHERE id = ?`).run(name)
    loadSkills()
  }

  export async function promoteTool(id: string) {
    await ensure()
    if (!state.db) return
    const row = state.tools.get(id)
    if (!row) return
    state.db.query(`UPDATE tool_cache SET is_l1 = 1, last_used = ? WHERE id = ?`).run(now(), id)
    loadTools()
    await enforceToolLimit(id)
    return state.tools.get(id)
  }

  export async function demoteTool(id: string) {
    await ensure()
    if (!state.db) return
    state.db.query(`UPDATE tool_cache SET is_l1 = 0 WHERE id = ?`).run(id)
    loadTools()
    return state.tools.get(id)
  }

  export async function promoteSkill(name: string) {
    await ensure()
    if (!state.db) return
    const row = state.skills.get(name)
    if (!row) return
    state.db.query(`UPDATE skill_cache SET is_l1 = 1, last_used = ? WHERE id = ?`).run(now(), name)
    loadSkills()
    await enforceSkillLimit(name)
    return state.skills.get(name)
  }

  export async function demoteSkill(name: string) {
    await ensure()
    if (!state.db) return
    state.db.query(`UPDATE skill_cache SET is_l1 = 0 WHERE id = ?`).run(name)
    loadSkills()
    return state.skills.get(name)
  }

  export async function touchTool(id: string) {
    await ensure()
    if (!state.db) return
    if (!state.tools.has(id)) return
    state.db.query(`UPDATE tool_cache SET last_used = ?, use_count = use_count + 1 WHERE id = ?`).run(now(), id)
    loadTools()
  }

  export async function touchSkill(name: string) {
    await ensure()
    if (!state.db) return
    if (!state.skills.has(name)) return
    state.db.query(`UPDATE skill_cache SET last_used = ?, use_count = use_count + 1 WHERE id = ?`).run(now(), name)
    loadSkills()
  }

  export async function list() {
    await ensure()
    return {
      tools: [...state.tools.values()],
      skills: [...state.skills.values()],
    }
  }

  export async function reembed() {
    await ensure()
    if (!state.db) return

    const conf = await cfg()
    for (const row of state.tools.values()) {
      const content = Embed.forTool(row)
      const hash = Embed.hash(content)
      const embedding = (await Embed.generate([content])).at(0)
      state.db
        .query(`UPDATE tool_cache SET embedding = ?, embed_model = ?, content_hash = ? WHERE id = ?`)
        .run(embedding ? bytes(embedding) : null, conf.embedModel ?? null, hash, row.id)
    }

    for (const row of state.skills.values()) {
      const content = Embed.forSkill(row)
      const hash = Embed.hash(content)
      const embedding = (await Embed.generate([content])).at(0)
      state.db
        .query(`UPDATE skill_cache SET embedding = ?, embed_model = ?, content_hash = ? WHERE id = ?`)
        .run(embedding ? bytes(embedding) : null, conf.embedModel ?? null, hash, row.id)
    }

    loadTools()
    loadSkills()
  }

  export async function systemHint() {
    if (!(await isEnabled())) return ""
    return [
      "You have access to a tool registry cache. Not all available tools and skills are shown by default.",
      "If your current tools seem insufficient for the task, use cache_discover_tool to search for additional tools by describing what you need, then cache_enable_tool to activate one.",
      "Use cache_discover_skill to find specialized skill instructions not currently listed.",
    ].join("\n")
  }

  export function close() {
    state.db?.close()
    state.db = undefined
    state.tools.clear()
    state.skills.clear()
    state.initialized = false
  }
}
