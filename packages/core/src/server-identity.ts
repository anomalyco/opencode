export * as ServerIdentity from "./server-identity.js"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"

import { NonNegativeInt, optional } from "@opencode/schema/schema"
import { ServerIdentity } from "@opencode/schema/server-identity"

import { Database } from "./database/database.js"
import { KV } from "./kv.js"
import { ServerSessionTable, ServerUserTable } from "./server-identity/sql.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export const Method = ServerIdentity.Method
export type Method = ServerIdentity.Method

export const SessionMethod = ServerIdentity.SessionMethod
export type SessionMethod = ServerIdentity.SessionMethod

export const UserStatus = ServerIdentity.UserStatus
export type UserStatus = ServerIdentity.UserStatus

export const UserID = ServerIdentity.UserID
export type UserID = ServerIdentity.UserID

export const SessionID = ServerIdentity.SessionID
export type SessionID = ServerIdentity.SessionID

/**
 * Server access authentication. `local` replaces the shared password with identities stored in this server's
 * database: access then requires a signed-in user (or a pairing link), and the password no longer grants any
 * request, only the right to issue pairing links itself.
 */
export const Options = Schema.Struct({
  local: Schema.optional(Schema.Literal(true)),
})
export type Options = typeof Options.Type

export class User extends Schema.Class<User>("ServerIdentity.User")({
  id: UserID,
  method: Method,
  username: Schema.String,
  displayName: optional(Schema.String),
  email: optional(Schema.String),
  status: UserStatus,
}) {}

export class Session extends Schema.Class<Session>("ServerIdentity.Session")({
  id: SessionID,
  userID: optional(UserID),
  method: SessionMethod,
  // Unix seconds.
  expiresAt: NonNegativeInt,
}) {}

export type Verified = {
  readonly session: Session
  readonly user: User | undefined
}

export class UsernameTakenError extends Schema.TaggedError<UsernameTakenError>()("ServerIdentity.UsernameTakenError", {
  username: Schema.String,
}) {
  override get message() {
    return `Username ${this.username} is already taken`
  }
}

export class InvalidRegisterInputError extends Schema.TaggedError<InvalidRegisterInputError>()(
  "ServerIdentity.InvalidRegisterInputError",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason
  }
}

export class InvalidCredentialsError extends Schema.TaggedError<InvalidCredentialsError>()(
  "ServerIdentity.InvalidCredentialsError",
  {},
) {
  override get message() {
    return "Invalid username or password"
  }
}

export class AttemptLockedError extends Schema.TaggedError<AttemptLockedError>()(
  "ServerIdentity.AttemptLockedError",
  {
    username: Schema.String,
    retryAfter: NonNegativeInt,
  },
) {
  override get message() {
    return `Too many failed attempts for ${this.username}; try again later`
  }
}

export interface Interface {
  /** Registers a local account; fails when the username or password is invalid or the username is taken. */
  readonly register: (input: { readonly username: string; readonly password: string }) => Effect.Effect<
    User,
    UsernameTakenError | InvalidRegisterInputError
  >
  /**
   * Verifies a username and password against local accounts. Failed attempts lock the username for an
   * exponentially growing period; successful sign-in clears it.
   */
  readonly authenticate: (input: {
    readonly username: string
    readonly password: string
  }) => Effect.Effect<User, InvalidCredentialsError | AttemptLockedError>
  /** Issues a signed session for an identity, or a possession-only pairing session when there is no user. */
  readonly issue: (input: {
    readonly userID?: ServerIdentity.UserID
    readonly method: ServerIdentity.SessionMethod
    readonly expiresAt: Date
  }) => Effect.Effect<{ readonly token: string; readonly session: Session }>
  /** Returns the session and its user for a valid, unrevoked token, or undefined when the token is unusable. */
  readonly verify: (token: string) => Effect.Effect<Verified | undefined>
  /** Revokes one session; its token becomes immediately unusable. */
  readonly revoke: (id: ServerIdentity.SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerIdentity") {}

const usernamePattern = /^[A-Za-z0-9@._-]+$/
const passwordMinLength = 8
// Failed sign-ins lock the username from the fifth failure on, for up to 15 minutes, in this process only.
const attemptLimit = 5
const attemptFloor = 60_000
const attemptCeiling = 15 * 60_000

// Sessions are signed with a secret persisted in the database, so tokens survive restarts and password rotation
// does not leak into them; deleting the KV key invalidates every session at once.
const secretKey = "server-identity/session-secret"

function hmac(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

// Tokens are `v2.<session id>.<hmac>`; the database owns expiry and revocation, and the signature prevents
// guessing or tampering with ids.
function signToken(secret: string, id: SessionID) {
  const payload = `v2.${id}`
  return `${payload}.${hmac(secret, payload)}`
}

function tokenIdentity(token: string, secret: string) {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "v2") return undefined
  const payload = `${parts[0]}.${parts[1]}`
  const expected = Buffer.from(hmac(secret, payload))
  const actual = Buffer.from(parts[2])
  if (actual.length !== expected.length) return undefined
  return timingSafeEqual(actual, expected) ? (parts[1] as SessionID) : undefined
}

function decodeSecret(value: KV.Value | undefined) {
  if (typeof value !== "object" || value === null) return
  const secret = (value as { secret?: unknown }).secret
  return typeof secret === "string" && secret !== "" ? secret : undefined
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const kv = yield* KV.Service
    // The layer captures the caller's clock once: expiry, lockouts and revocations all read it, so tests
    // control time through their own provided Clock and the server reads wall time.
    const clock = yield* Clock.Clock
    let cachedSecret: string | undefined
    const secret = Effect.fn("ServerIdentity.secret")(function* () {
      if (cachedSecret) return cachedSecret
      const stored = decodeSecret(yield* kv.get(secretKey))
      if (stored) {
        cachedSecret = stored
        return stored
      }
      // Re-read after the upsert: a racing process may have written its own secret; whoever reads back
      // last wins, and only newly issued tokens sign with the winner.
      yield* kv.set(secretKey, { secret: randomBytes(32).toString("base64url") })
      const next = decodeSecret(yield* kv.get(secretKey))
      if (!next)
        return yield* Effect.die("server-identity: session secret vanished after upsert") satisfies Effect.Effect<
          string,
          never,
          never
        >
      cachedSecret = next
      return next
    })
    const attempts = new Map<string, { count: number; until: number }>()
    const lockedFor = (username: string, now: number) => {
      const attempt = attempts.get(username)
      if (!attempt || attempt.until <= now) return undefined
      return attempt
    }
    const punish = (username: string, now: number) => {
      const attempt = lockedFor(username, now) ?? attempts.get(username) ?? { count: 0, until: 0 }
      attempt.count++
      if (attempt.count >= attemptLimit)
        attempt.until = now + Math.min(2 ** (attempt.count - attemptLimit) * attemptFloor, attemptCeiling)
      // A hostile client cycling names must not grow this map without bound; pragmatic cap.
      if (attempts.size > 10_000) attempts.clear()
      attempts.set(username, attempt)
    }

    const toUser = (row: typeof ServerUserTable.$inferSelect) =>
      new User({
        id: row.id,
        method: row.method,
        username: row.username,
        displayName: row.display_name ?? undefined,
        email: row.email ?? undefined,
        status: row.status,
      })
    const toSession = (row: typeof ServerSessionTable.$inferSelect) =>
      new Session({
        id: row.id,
        userID: row.user_id ?? undefined,
        method: row.method,
        expiresAt: row.expires_at,
      })

    return Service.of({
      register: Effect.fn("ServerIdentity.register")(function* (input) {
        if (!usernamePattern.test(input.username))
          yield* new InvalidRegisterInputError({
            reason: "Usernames may only contain letters, numbers, @, ., _ and -",
          })
        if (input.password.length < passwordMinLength)
          yield* new InvalidRegisterInputError({ reason: `Passwords must have at least ${passwordMinLength} characters` })
        const passwordHash = yield* Effect.tryPromise(() =>
          Bun.password.hash(input.password, { algorithm: "argon2id" }),
        ).pipe(Effect.orDie)
        const inserted = yield* db
          .insert(ServerUserTable)
          .values({
            id: UserID.create(),
            method: "password",
            username: input.username,
            password_hash: passwordHash,
          })
          .onConflictDoNothing({ target: [ServerUserTable.method, ServerUserTable.username] })
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!inserted) yield* new UsernameTakenError({ username: input.username })
        return toUser(inserted)
      }),
      authenticate: Effect.fn("ServerIdentity.authenticate")(function* (input) {
        const now = clock.currentTimeMillisUnsafe()
        const attempt = lockedFor(input.username, now)
        if (attempt)
          yield* new AttemptLockedError({
            username: input.username,
            retryAfter: Math.ceil((attempt.until - now) / 1000),
          })
        const row = yield* db
          .select()
          .from(ServerUserTable)
          .where(and(eq(ServerUserTable.method, "password"), eq(ServerUserTable.username, input.username)))
          .get()
          .pipe(Effect.orDie)
        const invalid = Effect.suspend(() => {
          punish(input.username, now)
          return new InvalidCredentialsError({})
        })
        const storedHash = row?.password_hash
        if (row !== undefined && storedHash !== null && storedHash !== undefined) {
          const passwordMatches = yield* Effect.tryPromise(() =>
            Bun.password.verify(input.password, storedHash),
          ).pipe(Effect.orDie)
          // Disabled accounts report the same "invalid credentials" to avoid telling an attacker the account exists.
          if (!passwordMatches || row.status !== "active") yield* invalid
          attempts.delete(input.username)
          return toUser(row)
        }
        return yield* invalid
      }),
      issue: Effect.fn("ServerIdentity.issue")(function* (input) {
        const signingSecret = yield* secret()
        const id = SessionID.create()
        const inserted = yield* db
          .insert(ServerSessionTable)
          .values({
            id,
            user_id: input.userID ?? null,
            method: input.method,
            expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          })
          .returning()
          .get()
          .pipe(Effect.orDie)
        return { token: signToken(signingSecret, id), session: toSession(inserted) }
      }),
      verify: Effect.fn("ServerIdentity.verify")(function* (token) {
        const now = clock.currentTimeMillisUnsafe()
        const signingSecret = yield* secret()
        const id = tokenIdentity(token, signingSecret)
        if (!id) return
        const row = yield* db.select().from(ServerSessionTable).where(eq(ServerSessionTable.id, id)).get().pipe(
          Effect.orDie,
        )
        // A disabled user's sessions stop verifying: the row lookup happens first, but the status check below invalidates them.
        if (!row || row.revoked_at !== null || row.expires_at * 1000 <= now) return
        const user = row.user_id
          ? yield* db.select().from(ServerUserTable).where(eq(ServerUserTable.id, row.user_id)).get().pipe(
                Effect.orDie,
              )
          : undefined
        if (row.user_id && (!user || user.status !== "active")) return
        return { session: toSession(row), user: user ? toUser(user) : undefined }
      }),
      revoke: Effect.fn("ServerIdentity.revoke")(function* (id) {
        const now = clock.currentTimeMillisUnsafe()
        yield* db
          .update(ServerSessionTable)
          .set({ revoked_at: Math.floor(now / 1000) })
          .where(eq(ServerSessionTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, KV.node] })
