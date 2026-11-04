// P-FILE and P-ORACLE helper for F.4, driven by crates/local/tests/interop.rs.
//
//   bun F.4-local.ts <ts-root> lock-hold <dir> <key> <staleMs>   acquire, print "acquired", release on a stdin line
//   bun F.4-local.ts <ts-root> lock-try <dir> <key> <timeoutMs> <staleMs>   print "acquired" or "timeout"
//   bun F.4-local.ts <ts-root> oracle                            channel and registration functions as JSON
//   bun F.4-local.ts <ts-root> config <get|set|unset> [args...]  `opencode service` config operations
//
// <ts-root> is a checkout of this repository. The lock commands import only Node built-ins; oracle
// and config need its node_modules. config uses the XDG variables of its environment, so callers
// point them at a temporary directory.

const [root, command, ...args] = process.argv.slice(2)
if (!root || !command) throw new Error("usage: F.4-local.ts <ts-root> <command> [args...]")

const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/cli/src`))

if (command === "lock-hold") {
  const { Flock } = await import(`${root}/packages/util/src/flock.ts`)
  const lease = await Flock.acquire(args[1], { dir: args[0], staleMs: Number(args[2]) })
  console.log("acquired")
  for await (const _ of console) break
  await lease.release()
  console.log("released")
}

if (command === "lock-try") {
  const { Flock } = await import(`${root}/packages/util/src/flock.ts`)
  const result = await Flock.acquire(args[1], {
    dir: args[0],
    timeoutMs: Number(args[2]),
    staleMs: Number(args[3]),
    baseDelayMs: 10,
    maxDelayMs: 50,
  }).then(
    async (lease: { release: () => Promise<void> }) => {
      await lease.release()
      return "acquired"
    },
    (error: Error) => (error.message.startsWith("Timed out") ? "timeout" : `error: ${error.message}`),
  )
  console.log(result)
}

if (command === "oracle") {
  const { ServiceConfig } = await load("./services/service-config")
  const { Service } = await load("@opencode/client/effect/service")
  const { Schema, Option } = await load("effect")
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Service.Info))
  const channels = ["latest", "dev", "beta", "next", "local", "oc-opentui-next", "feat/a b", "x", "ünï"]
  const versions = [
    "1.2.3",
    "0.0.0-oc-x-1",
    "0.0.0-oc-x-1.2",
    "0.0.0-oc-x-1.",
    "0.0.0-oc-x-",
    "0.0.0-oc-y-1",
    "0.0.0-oc-x-١",
  ]
  const registrations = [
    '{"id":"a","version":"1","url":"http://x","pid":3,"password":"p","extra":1}',
    '{"url":"http://x","pid":3.0}',
    '{"url":"http://x","pid":0}',
    '{"url":"http://x","pid":1.5}',
    '{"url":"http://x","pid":"1"}',
    '{"url":"http://x","pid":1,"password":null}',
    '{"url":1,"pid":1}',
    '{"pid":1}',
    "[]",
    "{",
    "",
  ]
  console.log(
    JSON.stringify({
      channels: channels.map((channel) => ({
        channel,
        filename: ServiceConfig.filename(channel),
        legacy: ServiceConfig.legacyFilename(channel) ?? null,
        port: ServiceConfig.defaultPort(channel, "linux"),
        windows: ServiceConfig.defaultPort(channel, "win32"),
      })),
      versions: versions.map((version) => ({
        version,
        belongs: ServiceConfig.versionBelongsToChannel(version, "oc-x", "1.2.3"),
      })),
      registrations: registrations.map((text) => ({ text, decoded: Option.getOrNull(decode(text)) })),
    }),
  )
}

if (command === "config") {
  const { ServiceConfig } = await load("./services/service-config")
  const { Global } = await load("@opencode/util/global")
  const { Effect } = await load("effect")
  const { NodeServices } = await load("@effect/platform-node")
  const [op, ...rest] = args
  const program =
    op === "get"
      ? ServiceConfig.get(rest[0], rest[1])
      : op === "set"
        ? ServiceConfig.set(rest[0], rest[1], rest[2])
        : ServiceConfig.unset(rest[0], rest[1])
  // Validation errors are thrown inside the generators, so they arrive as defects.
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(Global.layerWith({})), Effect.provide(NodeServices.layer)),
  ).then(
    (ok: unknown) => ({ ok: ok ?? null }),
    (error: Error) => ({ error: error.message }),
  )
  console.log(JSON.stringify(result))
}
