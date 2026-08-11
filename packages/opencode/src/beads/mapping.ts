import { Schema, Types } from "effect"
import { Effect } from "effect"
import path from "path"

export const MAPPING_FILENAME = "opencode-beads.json"

export const MappingEntry = Schema.Struct({
  title: Schema.String,
  status: Schema.String,
  priority: Schema.String,
  sessions: Schema.Record(Schema.String, Schema.Number),
  created_at: Schema.String,
  updated_at: Schema.String,
})
export type MappingEntry = Types.DeepMutable<Schema.Schema.Type<typeof MappingEntry>>

export const MappingFile = Schema.Struct({
  version: Schema.Literal(1),
  mapping: Schema.Record(Schema.String, MappingEntry),
})
export type MappingFile = Types.DeepMutable<Schema.Schema.Type<typeof MappingFile>>

export class MappingNotFoundError extends Schema.TaggedErrorClass<MappingNotFoundError>()("MappingNotFoundError", {
  dir: Schema.String,
}) {}

function defaultMappingEntry(title: string, status: string, priority: string): MappingEntry {
  return {
    title,
    status,
    priority,
    sessions: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function loadMapping(dir: string): Effect.Effect<MappingFile, MappingNotFoundError> {
  return Effect.gen(function* () {
    const filepath = path.join(dir, MAPPING_FILENAME)
    const content = yield* Effect.tryPromise(() => Bun.file(filepath).text())
    if (!content) throw new MappingNotFoundError({ dir })
    const parsed = JSON.parse(content)
    try {
      return Schema.decodeUnknownSync(MappingFile)(parsed)
    } catch {
      throw new MappingNotFoundError({ dir })
    }
  }).pipe(Effect.catch(() => Effect.fail(new MappingNotFoundError({ dir }))))
}

function saveMapping(dir: string, mapping: MappingFile): Effect.Effect<void> {
  return Effect.sync(() => {
    const filepath = path.join(dir, MAPPING_FILENAME)
    const dirPath = path.dirname(filepath)
    Bun.write(filepath, JSON.stringify(mapping, null, 2))
  })
}

function findEntryBySession(mapping: MappingFile, sessionID: string, position: number): string | null {
  for (const [beadsId, entry] of Object.entries(mapping.mapping)) {
    if (entry.sessions[sessionID] === position) return beadsId
  }
  return null
}

function addSession(mapping: MappingFile, beadsId: string, sessionID: string, position: number): void {
  const entry = mapping.mapping[beadsId]
  if (!entry) {
    throw new Error(`beads ID not found in mapping: ${beadsId}`)
  }
  entry.sessions = { ...entry.sessions, [sessionID]: position }
  entry.updated_at = new Date().toISOString()
}

function removeSession(mapping: MappingFile, beadsId: string, sessionID: string): void {
  const entry = mapping.mapping[beadsId]
  if (!entry) return
  const nextSessions = { ...entry.sessions }
  delete nextSessions[sessionID]
  entry.sessions = nextSessions
  entry.updated_at = new Date().toISOString()
  if (Object.keys(entry.sessions).length === 0) {
    delete mapping.mapping[beadsId]
  }
}

function cleanupStaleSessions(mapping: MappingFile, activeSessionIDs: Set<string>): void {
  const nextMapping: Record<string, MappingEntry> = {}
  for (const [beadsId, entry] of Object.entries(mapping.mapping)) {
    const nextSessions: Record<string, number> = {}
    for (const [sid, pos] of Object.entries(entry.sessions)) {
      if (activeSessionIDs.has(sid)) {
        nextSessions[sid] = pos
      }
    }
    if (Object.keys(nextSessions).length > 0) {
      nextMapping[beadsId] = { ...entry, sessions: nextSessions }
    }
  }
  mapping.mapping = nextMapping
}

function createNewEntry(title: string, status: string, priority: string): MappingEntry {
  return defaultMappingEntry(title, status, priority)
}

function addEntry(mapping: MappingFile, beadsId: string, entry: MappingEntry): void {
  mapping.mapping = { ...mapping.mapping, [beadsId]: entry }
}

export const Mapping = {
  load: loadMapping,
  save: saveMapping,
  findEntryBySession,
  addSession,
  removeSession,
  cleanupStaleSessions,
  createNewEntry,
  addEntry,
  MAPPING_FILENAME,
}
