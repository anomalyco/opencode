export * as Store from "./store"

import { eq, desc, and } from "drizzle-orm"
import { user_profile, personalization_memory, developer_behavior_event } from "./schema"
import type { UserProfileData } from "./profile"
import { DEFAULT_USER_PROFILE, applyProfileDrift } from "./profile"
import type { MemoryRecord, MemoryTier } from "./memory"
import { generateEmbedding } from "./memory"

// Generic minimal Drizzle SQLite database interface
export interface DatabaseSession {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete?: (...args: any[]) => any
}

import { Effect } from "effect"

// Generic helper to safely execute both Effect-Drizzle operations and standard Promise-based Drizzle queries
async function exec<T>(effectOrPromise: any): Promise<T> {
  if (Effect.isEffect(effectOrPromise)) {
    return await Effect.runPromise(effectOrPromise as Effect.Effect<T, any, never>)
  }
  if (effectOrPromise && typeof effectOrPromise.then === "function") {
    return await effectOrPromise
  }
  return effectOrPromise
}

export async function loadUserProfile(
  db: any,
  userId: string,
): Promise<UserProfileData> {
  if (!db) return { ...DEFAULT_USER_PROFILE }
  const row: any = await exec(
    db
      .select()
      .from(user_profile)
      .where(eq(user_profile.user_id, userId))
      .get(),
  )

  if (row && row.profile_json) {
    return row.profile_json as UserProfileData
  }

  return { ...DEFAULT_USER_PROFILE }
}

export async function saveUserProfile(
  db: any,
  userId: string,
  profile: UserProfileData,
  userVector?: Float32Array,
): Promise<void> {
  if (!db) return
  const now = Date.now()
  const existing: any = await exec(
    db
      .select()
      .from(user_profile)
      .where(eq(user_profile.user_id, userId))
      .get(),
  )

  if (existing) {
    await exec(
      db
        .update(user_profile)
        .set({
          profile_json: profile,
          user_vector: userVector ?? existing.user_vector,
          update_count: (existing.update_count ?? 0) + 1,
          updated_at: now,
        })
        .where(eq(user_profile.user_id, userId))
        .run(),
    )
  } else {
    await exec(
      db
        .insert(user_profile)
        .values({
          user_id: userId,
          profile_json: profile,
          user_vector: userVector,
          update_count: 1,
          created_at: now,
          updated_at: now,
        })
        .run(),
    )
  }
}

export async function loadMemories(
  db: any,
  userId: string,
  tier?: MemoryTier,
): Promise<MemoryRecord[]> {
  if (!db) return []
  const query = tier
    ? db
        .select()
        .from(personalization_memory)
        .where(
          and(
            eq(personalization_memory.user_id, userId),
            eq(personalization_memory.tier, tier),
          ),
        )
        .orderBy(desc(personalization_memory.updated_at))
    : db
        .select()
        .from(personalization_memory)
        .where(eq(personalization_memory.user_id, userId))
        .orderBy(desc(personalization_memory.updated_at))

  const rows: any = await exec(query.all())

  return (rows || []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    tier: r.tier,
    category: r.category,
    content: r.content,
    confidence: r.confidence ?? 1.0,
    accessCount: r.access_count ?? 0,
    embedding: r.embedding,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  }))
}

export async function saveMemory(
  db: any,
  memory: MemoryRecord,
): Promise<void> {
  if (!db) return
  const now = Date.now()
  const embedding = memory.embedding ?? (await generateEmbedding(memory.content).catch(() => undefined))

  await exec(
    db
      .insert(personalization_memory)
      .values({
        id: memory.id,
        user_id: memory.userId,
        tier: memory.tier,
        category: memory.category,
        content: memory.content,
        confidence: memory.confidence,
        access_count: memory.accessCount,
        embedding,
        metadata: memory.metadata,
        created_at: memory.createdAt || now,
        updated_at: memory.updatedAt || now,
        expires_at: memory.expiresAt,
      })
      .run(),
  )
}

export async function logBehaviorEvent(
  db: any,
  event: {
    id?: string
    userId: string
    sessionId?: string
    eventType: "prompt_correction" | "diff_accepted" | "diff_rejected" | "tool_invoked" | "explicit_preference"
    contextText: string
    inferredKey?: string
    inferredValue?: string
    weight?: number
  },
): Promise<void> {
  if (!db) return
  const now = Date.now()
  const eventId = event.id || `evt_${now}_${Math.random().toString(36).slice(2, 7)}`

  await exec(
    db
      .insert(developer_behavior_event)
      .values({
        id: eventId,
        user_id: event.userId,
        session_id: event.sessionId,
        event_type: event.eventType,
        context_text: event.contextText,
        inferred_key: event.inferredKey,
        inferred_value: event.inferredValue,
        weight: event.weight ?? 1.0,
        applied: false,
        created_at: now,
      })
      .run(),
  )
}
