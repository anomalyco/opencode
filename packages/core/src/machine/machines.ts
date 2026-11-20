export * as Machines from "./machines.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Environment } from "../environment/index.js"
import { Machine } from "./index.js"
import { MachineTable } from "./sql.js"

/**
 * A machine's name, as a path will use it: `gpu:/work`. Two characters or more, so a Windows drive such as `C:` is
 * never a machine, and never `local`, which is the server's own machine.
 */
export const Name = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]+$/),
  Schema.makeFilter((name) => name !== Environment.localID, { expected: "a name other than local" }),
)

export class Info extends Schema.Class<Info>("Machines.Info")({
  id: Environment.ID,
  online: Schema.Boolean,
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
    return `${JSON.stringify(this.name)} is not a machine name. Use lowercase letters, digits and hyphens, starting with a letter, two characters or more, and not "local".`
  }
}

export class AlreadyExists extends Schema.TaggedError<AlreadyExists>()("Machines.AlreadyExists", {
  machine: Environment.ID,
}) {
  override get message() {
    return `${JSON.stringify(this.machine)} is already a machine.`
  }
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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Machines") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const locks = KeyedMutex.makeUnsafe<Environment.ID>()
    // Known names are read once per process; a machine another process adds or removes in the shared database shows up
    // here on restart, as with process-local session execution until clustering. Live connections stay in the dialling process.
    const rows = yield* db.select({ id: MachineTable.id }).from(MachineTable).all().pipe(Effect.orDie)
    // One instance per known id for the life of the process: its running processes must survive reconnects.
    const instances = new Map<Environment.ID, Machine.Interface>(rows.map((row) => [row.id, Machine.make(row.id)]))

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
          }),
        )
        return id
      }),
      remove: Effect.fn("Machines.remove")(function* (id) {
        yield* locks.withLock(id)(
          Effect.gen(function* () {
            const machine = instances.get(id)
            if (!machine) return
            yield* db.delete(MachineTable).where(eq(MachineTable.id, id)).run().pipe(Effect.orDie)
            instances.delete(id)
            machine.close(new NotFound({ machine: id }))
          }),
        )
      }),
      list: Effect.fn("Machines.list")(function* () {
        return [...instances]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, machine]) => {
            const hello = machine.hello()
            return hello
              ? new Info({ id, online: true, os: hello.os, arch: hello.arch })
              : new Info({ id, online: false })
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
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
