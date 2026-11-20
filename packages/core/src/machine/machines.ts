export * as Machines from "./machines.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { createHash, randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Environment } from "../environment/index.js"
import { Identity } from "./identity.js"
import { Machine } from "./index.js"
import { Join } from "./join.js"
import { MachineTable } from "./sql.js"

/**
 * A machine's name, as a path will use it: `gpu:/work`. Two characters or more, so a Windows drive such as `C:` is
 * never a machine, and never `local`, which is the server's own machine. At most 63, like a DNS label, so the link's
 * welcome, which carries the name, always fits in one Noise message.
 */
export const Name = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{1,62}$/),
  Schema.makeFilter((name) => name !== Environment.localID, { expected: "a name other than local" }),
)

export class Info extends Schema.Class<Info>("Machines.Info")({
  id: Environment.ID,
  online: Schema.Boolean,
  /** Whether the machine has joined with its key. Until then it is known by name only. */
  paired: Schema.Boolean,
  /** Last reported by the worker's hello, while it is online. */
  os: Schema.optionalKey(Schema.String),
  arch: Schema.optionalKey(Schema.String),
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("Machines.NotFound", {
  machine: Environment.ID,
}) {
  override get message() {
    return `No machine named ${JSON.stringify(this.machine)}.`
  }
}

export class InvalidName extends Schema.TaggedError<InvalidName>()("Machines.InvalidName", {
  name: Schema.String,
}) {
  override get message() {
    return `${JSON.stringify(this.name)} is not a machine name. Use lowercase letters, digits and hyphens, starting with a letter, 2 to 63 characters, and not "local".`
  }
}

export class AlreadyExists extends Schema.TaggedError<AlreadyExists>()("Machines.AlreadyExists", {
  machine: Environment.ID,
}) {
  override get message() {
    return `${JSON.stringify(this.machine)} is already a machine.`
  }
}

export class AlreadyPaired extends Schema.TaggedError<AlreadyPaired>()("Machines.AlreadyPaired", {
  machine: Environment.ID,
}) {
  override get message() {
    return `${JSON.stringify(this.machine)} is already paired. Use replace to pair it again.`
  }
}

/** One failure for every rejected join, saying nothing about which step rejected it. */
export class InvalidJoin extends Schema.TaggedError<InvalidJoin>()("Machines.InvalidJoin", {}) {
  override get message() {
    return "That join string is not valid."
  }
}

export class UnknownKey extends Schema.TaggedError<UnknownKey>()("Machines.UnknownKey", {}) {
  override get message() {
    return "No machine has that key."
  }
}

export interface InviteOptions {
  readonly reach: ReadonlyArray<Join.Reach>
  /** Pairs the machine again, replacing the key its current worker holds. */
  readonly replace?: boolean
}

export interface Interface {
  /** Makes the machine known for good, returning its validated ID. Its live state is whatever its next connection reports. */
  readonly add: (name: string) => Effect.Effect<Environment.ID, InvalidName | AlreadyExists>
  /** Forgets the machine and ends it, failing what waits on it as `NotFound` and its processes at once. */
  readonly remove: (id: Environment.ID) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  /** The machine's environment, connected or not: calls on an offline machine fail with `NotSent`. */
  readonly get: (id: Environment.ID) => Effect.Effect<Environment.Interface, NotFound>
  /** The home directory in the hello of the machine's connection, failing with `NotSent` while it is offline. */
  readonly home: (id: Environment.ID) => Effect.Effect<string, NotFound | Machine.NotSent>
  /** Serves one worker's connection, routed by the name in its hello, until it is lost or replaced. */
  readonly connect: (connection: Machine.Connection) => Effect.Effect<void, NotFound>
  /** Prints one join string for this machine, good once and for five minutes. A second invite replaces the first. */
  readonly invite: (
    id: Environment.ID,
    options: InviteOptions,
  ) => Effect.Effect<string, NotFound | AlreadyPaired | Identity.InvalidKey>
  /** Pairs the machine holding the secret's join string with `key` and returns its id. The secret is spent either way. */
  readonly join: (input: {
    readonly secret: Uint8Array
    readonly key: Uint8Array
  }) => Effect.Effect<Environment.ID, InvalidJoin>
  /** The machine a paired worker's key belongs to, for its next connection. */
  readonly identify: (key: Uint8Array) => Effect.Effect<Environment.ID, UnknownKey>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Machines") {}

const SECRET_BYTES = 32
const KEY_BYTES = 32
/** How long a printed join string stays good. */
const INVITE_TTL = 5 * 60 * 1000
const digest = (secret: Uint8Array) => createHash("sha256").update(secret).digest("base64url")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const identity = yield* Identity.Service
    // The work under each name's lock is uninterruptible, so an interruption, such as a dropped connection mid-join,
    // never leaves a row written without memory updated to match; waiting for the lock stays interruptible.
    const locks = KeyedMutex.makeUnsafe<Environment.ID>()
    // Known names are read once per process; a machine another process adds or removes in the shared database shows up
    // here on restart, as with process-local session execution until clustering. Live connections stay in the dialling process.
    const rows = yield* db
      .select({ id: MachineTable.id, key: MachineTable.key })
      .from(MachineTable)
      .all()
      .pipe(Effect.orDie)
    // One instance per known id for the life of the process: its running processes must survive reconnects.
    const instances = new Map<Environment.ID, Machine.Interface>(rows.map((row) => [row.id, Machine.make(row.id)]))
    // Keys are the one durable part of pairing, read here and written by `join`, so `identify` answers from memory.
    const keys = new Map<Environment.ID, string>(
      rows.flatMap((row) => (row.key === null ? [] : [[row.id, row.key] as const])),
    )
    // Pending invitations are per process, like live connections: the home that printed a join string is the one that
    // receives the worker, until clustering. One per name, holding only the secret's hash, never the secret.
    const invitations = new Map<
      Environment.ID,
      { readonly hash: string; readonly expires: number; readonly replace: boolean }
    >()

    return Service.of({
      add: Effect.fn("Machines.add")(function* (name) {
        if (!Schema.is(Name)(name)) return yield* new InvalidName({ name })
        const id = Environment.ID.make(name)
        yield* locks.withLock(id)(
          Effect.gen(function* () {
            if (instances.has(id)) return yield* new AlreadyExists({ machine: id })
            const inserted = yield* db
              .insert(MachineTable)
              .values({ id, time_created: yield* Clock.currentTimeMillis })
              .onConflictDoNothing()
              .returning({ id: MachineTable.id })
              .get()
              .pipe(Effect.orDie)
            // A row another process wrote is still a known machine, so it is taken into memory either way.
            instances.set(id, Machine.make(id))
            if (!inserted) return yield* new AlreadyExists({ machine: id })
          }).pipe(Effect.uninterruptible),
        )
        return id
      }),
      remove: Effect.fn("Machines.remove")(function* (id) {
        yield* locks.withLock(id)(
          Effect.gen(function* () {
            const machine = instances.get(id)
            if (!machine) return
            yield* db.delete(MachineTable).where(eq(MachineTable.id, id)).run().pipe(Effect.orDie)
            invitations.delete(id)
            keys.delete(id)
            instances.delete(id)
            machine.close(new NotFound({ machine: id }))
          }).pipe(Effect.uninterruptible),
        )
      }),
      list: Effect.fn("Machines.list")(function* () {
        return [...instances]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, machine]) => {
            const hello = machine.hello()
            return hello
              ? new Info({ id, online: true, paired: keys.has(id), os: hello.os, arch: hello.arch })
              : new Info({ id, online: false, paired: keys.has(id) })
          })
      }),
      get: Effect.fn("Machines.get")(function* (id) {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        return machine.environment
      }),
      home: Effect.fn("Machines.home")(function* (id) {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        const hello = machine.hello()
        if (!hello) return yield* new Machine.NotSent({ machine: id })
        return hello.home
      }),
      connect: Effect.fn("Machines.connect")(function* (connection) {
        const id = Environment.ID.make(connection.hello.name)
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        yield* machine.connect(connection)
      }),
      invite: Effect.fn("Machines.invite")(function* (id, options) {
        // The two yields come first, so every check and the `set` below run without one between them.
        const home = yield* identity.publicKey()
        const now = yield* Clock.currentTimeMillis
        if (!instances.has(id)) return yield* new NotFound({ machine: id })
        if (keys.has(id) && !options.replace) return yield* new AlreadyPaired({ machine: id })
        const secret = randomBytes(SECRET_BYTES)
        const expires = now + INVITE_TTL
        invitations.set(id, { hash: digest(secret), expires, replace: options.replace === true })
        return Join.encode({ v: 1, home, secret, expires, reach: options.reach })
      }),
      join: Effect.fn("Machines.join")(function* (input) {
        // Only an Ed25519 public key is ever stored as a machine's key. The secret is not spent on a malformed call.
        if (input.key.length !== KEY_BYTES) return yield* new InvalidJoin()
        const hash = digest(input.secret)
        const found = [...invitations].find(([, invitation]) => invitation.hash === hash)
        if (!found) return yield* new InvalidJoin()
        const id = found[0]
        const key = Buffer.from(input.key).toString("base64url")
        yield* locks.withLock(id)(
          Effect.gen(function* () {
            const invitation = invitations.get(id)
            // Read again under the name's lock: an invite or removal since the scan above invalidates this one.
            if (!invitation || invitation.hash !== hash) return yield* new InvalidJoin()
            // Spent on the try, not on success: one join string pairs one worker, whatever happens next.
            invitations.delete(id)
            const now = yield* Clock.currentTimeMillis
            if (now >= invitation.expires) return yield* new InvalidJoin()
            if (keys.has(id) && !invitation.replace) return yield* new InvalidJoin()
            if ([...keys].some(([other, stored]) => stored === key && other !== id)) return yield* new InvalidJoin()
            const written = yield* db
              .update(MachineTable)
              .set({ key })
              .where(eq(MachineTable.id, id))
              .returning({ id: MachineTable.id })
              .get()
              // The unique index turns two names writing one key at the same instant into a defect here; the link
              // (next change) must turn every failure into one refusal.
              .pipe(Effect.orDie)
            if (!written) return yield* new InvalidJoin()
            keys.set(id, key)
          }).pipe(Effect.uninterruptible),
        )
        return id
      }),
      identify: Effect.fn("Machines.identify")(function* (key) {
        const encoded = Buffer.from(key).toString("base64url")
        const paired = [...keys].find(([, stored]) => stored === encoded)
        if (!paired) return yield* new UnknownKey()
        return paired[0]
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Identity.node] })
