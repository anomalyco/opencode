import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Clock, Effect } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "@opencode/core/database/database"
import { ServerIdentity } from "@opencode/core/server-identity"
import { ServerUserTable } from "@opencode/core/server-identity/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([ServerIdentity.node, Database.node])))

// TestClock starts at 0, so a far-future date stays verifiable and its year stays unrealistic.
const farFuture = new Date(2 ** 34)

const future = Effect.gen(function* () {
  return new Date((yield* Clock.currentTimeMillis) + 30 * 24 * 60 * 60 * 1000)
})
const past = Effect.gen(function* () {
  return new Date((yield* Clock.currentTimeMillis) - 60_000)
})

describe("ServerIdentity", () => {
  it.effect("registers an account and authenticates its password", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const user = yield* identity.register({ username: "ada", password: "s3cure-passw" })
      expect(user.username).toBe("ada")
      expect(user.method).toBe("password")
      expect(user.status).toBe("active")
      expect(yield* identity.authenticate({ username: "ada", password: "s3cure-passw" })).toEqual(user)
    }),
  )

  it.effect("rejects weak passwords, hostile usernames, and taken usernames", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const weak = yield* identity.register({ username: "ada", password: "short" }).pipe(Effect.flip)
      expect(weak._tag).toBe("ServerIdentity.InvalidRegisterInputError")
      const hostile = yield* identity.register({ username: "ada lovelace", password: "s3cure-passw" }).pipe(Effect.flip)
      expect(hostile._tag).toBe("ServerIdentity.InvalidRegisterInputError")
      yield* identity.register({ username: "grace", password: "first-passw1" })
      const taken = yield* identity.register({ username: "grace", password: "second-passw" }).pipe(Effect.flip)
      expect(taken._tag).toBe("ServerIdentity.UsernameTakenError")
    }),
  )

  it.effect("reports invalid credentials for wrong passwords and unknown usernames alike", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      yield* identity.register({ username: "ada", password: "s3cure-passw" })
      const wrong = yield* identity.authenticate({ username: "ada", password: "wrong-passw" }).pipe(Effect.flip)
      expect(wrong._tag).toBe("ServerIdentity.InvalidCredentialsError")
      const unknown = yield* identity.authenticate({ username: "nobody", password: "wrong-passw" }).pipe(Effect.flip)
      expect(unknown._tag).toBe("ServerIdentity.InvalidCredentialsError")
    }),
  )

  it.effect("locks a username after repeated failures and clears the lock on a correct sign-in", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      yield* identity.register({ username: "ada", password: "s3cure-passw" })
      for (let index = 0; index < 5; index++) {
        yield* identity.authenticate({ username: "ada", password: "wrong-passw" }).pipe(Effect.flip, Effect.asVoid)
      }
      const locked = yield* identity.authenticate({ username: "ada", password: "wrong-passw" }).pipe(Effect.flip)
      expect(locked._tag).toBe("ServerIdentity.AttemptLockedError")
      // Five failures lock for one minute; two virtual minutes are safely past it.
      yield* TestClock.adjust("2 minutes")
      expect(yield* identity.authenticate({ username: "ada", password: "s3cure-passw" })).toBeDefined()
      // The correct sign-in cleared the counter, so it takes the full five failures to lock again.
      for (let index = 0; index < 5; index++) {
        yield* identity.authenticate({ username: "ada", password: "wrong-passw" }).pipe(Effect.flip, Effect.asVoid)
      }
      const again = yield* identity.authenticate({ username: "ada", password: "wrong-passw" }).pipe(Effect.flip)
      expect(again._tag).toBe("ServerIdentity.AttemptLockedError")
      // The fresh lock still has most of its minute left, so half a minute later it must not have lifted.
      yield* TestClock.adjust("30 seconds")
      const stubborn = yield* identity.authenticate({ username: "ada", password: "s3cure-passw" }).pipe(Effect.flip)
      expect(stubborn._tag).toBe("ServerIdentity.AttemptLockedError")
      yield* TestClock.adjust("1 minute")
      expect(yield* identity.authenticate({ username: "ada", password: "s3cure-passw" })).toBeDefined()
    }),
  )

  it.effect("issues and verifies user and pairing sessions", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const user = yield* identity.register({ username: "ada", password: "s3cure-passw" })

      const issued = yield* identity.issue({ userID: user.id, method: "password", expiresAt: farFuture })
      const verified = yield* identity.verify(issued.token)
      expect(verified?.session.id).toBe(issued.session.id)
      expect(verified?.user?.id).toBe(user.id)

      const pairing = yield* identity.issue({ method: "pairing", expiresAt: farFuture })
      const pairingVerified = yield* identity.verify(pairing.token)
      expect(pairingVerified?.session.method).toBe("pairing")
      expect(pairingVerified?.user).toBeUndefined()
    }),
  )

  it.effect("rejects unusable tokens", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const issued = yield* identity.issue({ method: "pairing", expiresAt: farFuture })
      expect(yield* identity.verify(`${issued.token.slice(0, -2)}zz`)).toBeUndefined()
      expect(yield* identity.verify("1.abc")).toBeUndefined()
      expect(yield* identity.verify(issued.token.replace(/^v2/, "v3"))).toBeUndefined()
      expect(yield* identity.verify("")).toBeUndefined()
    }),
  )

  it.effect("stops verifying revoked and expired sessions", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const user = yield* identity.register({ username: "ada", password: "s3cure-passw" })

      const revoked = yield* identity.issue({ userID: user.id, method: "password", expiresAt: farFuture })
      yield* identity.revoke(revoked.session.id)
      expect(yield* identity.verify(revoked.token)).toBeUndefined()

      const expiring = yield* identity.issue({ userID: user.id, method: "password", expiresAt: yield* future })
      expect(yield* identity.verify(expiring.token)).toBeDefined()
      yield* TestClock.adjust("31 days")
      expect(yield* identity.verify(expiring.token)).toBeUndefined()

      const expired = yield* identity.issue({ method: "pairing", expiresAt: yield* past })
      expect(yield* identity.verify(expired.token)).toBeUndefined()
    }),
  )

  it.effect("stops verifying sessions of disabled users", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const user = yield* identity.register({ username: "ada", password: "s3cure-passw" })
      const issued = yield* identity.issue({ userID: user.id, method: "password", expiresAt: farFuture })
      expect(yield* identity.verify(issued.token)).toBeDefined()

      const database = yield* Database.Service
      yield* database.db
        .update(ServerUserTable)
        .set({ status: "disabled" })
        .where(eq(ServerUserTable.id, user.id))
        .run()
        .pipe(Effect.orDie)
      expect(yield* identity.verify(issued.token)).toBeUndefined()

      // Re-enabling restores verification without issuing a new token.
      yield* database.db
        .update(ServerUserTable)
        .set({ status: "active" })
        .where(eq(ServerUserTable.id, user.id))
        .run()
        .pipe(Effect.orDie)
      expect(yield* identity.verify(issued.token)).toBeDefined()
    }),
  )

  it.effect("signs sessions against a persisted secret", () =>
    Effect.gen(function* () {
      const identity = yield* ServerIdentity.Service
      const issued = yield* identity.issue({ method: "pairing", expiresAt: farFuture })
      expect(yield* identity.verify(issued.token)).toBeDefined()
    }),
  )
})
