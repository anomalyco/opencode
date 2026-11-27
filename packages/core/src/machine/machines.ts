export * as Machines from "./machines.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { createHash, randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect"
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
  connection: Schema.optionalKey(Machine.ConnectionInfo),
  /** The machine's last connection was refused, and it has not connected since. */
  refused: Schema.optionalKey(Machine.Refused),
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

/** A file on a machine, at an absolute path. */
export interface File {
  readonly machine: Environment.ID
  readonly path: string
}

/** A port on a machine's loopback. */
export interface Port {
  readonly machine: Environment.ID
  readonly port: number
}

export type PeerError = NotFound | Machine.PeerFailed | Machine.NotSent | Machine.Unknown

/** A machine waits for its worker to join; once paired, it has a link. */
export type Status = { readonly _tag: "AwaitingJoin" } | { readonly _tag: "Paired"; readonly link: Machine.Link }

/** Whether a request sent now reaches a worker. */
export const canSend = (status: Status) => status._tag === "Paired" && status.link._tag === "Connected"

/** Coarse and slow to change, so the system prompt can list it: "away" may come back on its own, "needs-you" won't. */
export const availability = (status: Status): "ready" | "away" | "needs-you" => {
  if (status._tag === "AwaitingJoin") return "needs-you"
  switch (status.link._tag) {
    case "Connected":
      return "ready"
    case "Refused":
      return "needs-you"
    case "Never":
    case "Disconnected":
      return "away"
  }
}

export interface Interface {
  /** Makes the machine known for good, returning its validated ID. Its live state is whatever its next connection reports. */
  readonly add: (name: string) => Effect.Effect<Environment.ID, InvalidName | AlreadyExists>
  /**
   * Forgets the machine and ends it, failing what waits on it as `NotFound` and its processes at once. False when there
   * was no such machine.
   */
  readonly remove: (id: Environment.ID) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  /** Every machine's status, sorted by id. */
  readonly statuses: () => Effect.Effect<ReadonlyArray<{ readonly id: Environment.ID; readonly status: Status }>>
  /** The machine's environment, connected or not: calls on an offline machine fail with `NotSent`. */
  readonly get: (id: Environment.ID) => Effect.Effect<Environment.Interface, NotFound>
  /** The home directory in the hello of the machine's connection, failing with `NotSent` while it is offline. */
  readonly home: (id: Environment.ID) => Effect.Effect<string, NotFound | Machine.NotSent>
  /**
   * Serves one worker's connection as the machine `id` until it is lost or replaced. `id` is the one the link's handshake
   * proved, never one the worker named.
   */
  readonly connect: (id: Environment.ID, connection: Machine.Connection) => Effect.Effect<void, NotFound>
  /** Remembers that the machine's connection was refused after its handshake, until it next connects. */
  readonly refuse: (id: Environment.ID, refusal: Machine.Refusal) => Effect.Effect<void>
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
  /**
   * Copies one file from one machine to another over a peer link between their workers, which it opens when there is
   * none. The receiving worker writes only the path the home named, and only a file the sender presents its token for.
   */
  readonly copy: (from: File, to: File) => Effect.Effect<void, PeerError>
  /** Maps `from`'s loopback port to `to`'s over their peer link, returning the forward's id. */
  readonly forward: (from: Port, to: Port) => Effect.Effect<string, PeerError>
  /** Ends a forward. False when there was no such forward. */
  readonly unforward: (id: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Machines") {}

const SECRET_BYTES = 32
const KEY_BYTES = 32
/** How long a printed join string stays good. */
const INVITE_TTL = 5 * 60 * 1000
const digest = (secret: Uint8Array) => createHash("sha256").update(secret).digest("base64url")
const token = () => randomBytes(SECRET_BYTES).toString("base64url")

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
    // The peer link between two machines, by the pair. It counts only while both workers report it up.
    const links = new Map<string, Machine.PeerLink>()
    const linking = KeyedMutex.makeUnsafe<string>()
    const forwards = new Map<
      string,
      { readonly from: Machine.Interface; readonly to: Machine.Interface; readonly token: string }
    >()

    const revoke = (machine: Machine.Interface, grant: string) =>
      machine.peer({ type: "peer-revoke", token: grant }).pipe(Effect.ignore)

    const paired = (id: Environment.ID) =>
      Effect.gen(function* () {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        const key = keys.get(id)
        if (!key) return yield* new Machine.PeerFailed({ machine: id, reason: "not paired" })
        return { machine, key }
      })

    // The link `from` dials and `to` accepts, reused while both still have it.
    const link = (fromID: Environment.ID, toID: Environment.ID) =>
      Effect.gen(function* () {
        if (fromID === toID)
          return yield* new Machine.PeerFailed({ machine: fromID, reason: "both ends are on the same machine" })
        const from = yield* paired(fromID)
        const to = yield* paired(toID)
        const pair = [fromID, toID].toSorted().join(" ")
        const id = yield* linking.withLock(pair)(
          Effect.gen(function* () {
            const current = links.get(pair)
            if (current && from.machine.links().has(current) && to.machine.links().has(current)) return current
            if (current)
              yield* Effect.all(
                [from, to].map((side) => side.machine.peer({ type: "peer-close", link: current }).pipe(Effect.ignore)),
                { concurrency: "unbounded" },
              )
            links.delete(pair)
            const next = Machine.PeerLink.make(crypto.randomUUID())
            yield* Effect.all(
              [
                to.machine.peer({ type: "peer-accept", link: next, key: from.key }),
                from.machine.peer({ type: "peer-connect", link: next, key: to.key }),
              ],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.onError(() =>
                Effect.all(
                  [from, to].map((side) => side.machine.peer({ type: "peer-close", link: next }).pipe(Effect.ignore)),
                  { concurrency: "unbounded" },
                ),
              ),
            )
            links.set(pair, next)
            return next
          }),
        )
        return { id, from: from.machine, to: to.machine }
      })

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
        return yield* locks.withLock(id)(
          Effect.gen(function* () {
            const machine = instances.get(id)
            if (!machine) return false
            yield* db.delete(MachineTable).where(eq(MachineTable.id, id)).run().pipe(Effect.orDie)
            invitations.delete(id)
            keys.delete(id)
            instances.delete(id)
            machine.close(new NotFound({ machine: id }))
            return true
          }).pipe(Effect.uninterruptible),
        )
      }),
      list: Effect.fn("Machines.list")(function* () {
        return [...instances]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, machine]) => {
            const link = machine.state()
            const paired = keys.has(id)
            switch (link._tag) {
              case "Connected": {
                const connection = link.describe?.()
                return new Info({
                  id,
                  online: true,
                  paired,
                  os: link.hello.os,
                  arch: link.hello.arch,
                  ...(connection ? { connection } : {}),
                })
              }
              case "Refused":
                return new Info({ id, online: false, paired, refused: link })
              case "Never":
              case "Disconnected":
                return new Info({ id, online: false, paired })
            }
          })
      }),
      statuses: Effect.fn("Machines.statuses")(function* () {
        return [...instances]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, machine]) => ({
            id,
            status: keys.has(id)
              ? { _tag: "Paired" as const, link: machine.state() }
              : { _tag: "AwaitingJoin" as const },
          }))
      }),
      get: Effect.fn("Machines.get")(function* (id) {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        return machine.environment
      }),
      home: Effect.fn("Machines.home")(function* (id) {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        const link = machine.state()
        if (link._tag !== "Connected") return yield* Machine.notSent(id, link)
        return link.hello.home
      }),
      connect: Effect.fn("Machines.connect")(function* (id, connection) {
        const machine = instances.get(id)
        if (!machine) return yield* new NotFound({ machine: id })
        yield* machine.connect(connection)
      }),
      refuse: Effect.fn("Machines.refuse")(function* (id, reason) {
        const at = yield* DateTime.now
        instances.get(id)?.refuse(new Machine.Refused({ at, reason }))
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
      copy: Effect.fn("Machines.copy")(function* (from, to) {
        const shared = yield* link(from.machine, to.machine)
        const grant = token()
        yield* Effect.all(
          [
            shared.to.peer({ type: "peer-receive", link: shared.id, token: grant, path: to.path }),
            shared.from.peer({ type: "peer-send", link: shared.id, token: grant, path: from.path }),
          ],
          { concurrency: "unbounded" },
          // A lost answer is no failure: the transfer goes on between the workers.
        ).pipe(
          Effect.tapError((error) => (error._tag === "Machine.PeerFailed" ? revoke(shared.to, grant) : Effect.void)),
        )
      }),
      forward: Effect.fn("Machines.forward")(function* (from, to) {
        const shared = yield* link(from.machine, to.machine)
        const grant = token()
        yield* shared.to.peer({ type: "peer-allow", link: shared.id, token: grant, port: to.port })
        yield* shared.from
          .peer({ type: "peer-forward", link: shared.id, token: grant, port: from.port })
          .pipe(
            Effect.tapError((error) => (error._tag === "Machine.PeerFailed" ? revoke(shared.to, grant) : Effect.void)),
          )
        const id = crypto.randomUUID()
        forwards.set(id, { from: shared.from, to: shared.to, token: grant })
        return id
      }),
      unforward: Effect.fn("Machines.unforward")(function* (id) {
        const forward = forwards.get(id)
        if (!forward) return false
        forwards.delete(id)
        yield* Effect.all(
          [forward.from, forward.to].map((side) => revoke(side, forward.token)),
          { concurrency: "unbounded" },
        )
        return true
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Identity.node] })
