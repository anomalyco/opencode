// P-TUI fixed clock, preloaded into the TS server and client: with OPENCODE_DRIVE_NOW (milliseconds since the epoch),
// `Date` starts at that instant and runs on, so dates the screen shows do not follow the day of the run. Both processes
// of a side also share OPENCODE_DRIVE_SINCE, the run's start on the real clock, so the simulated clock is one timeline:
// the server's and the client's own start delays do not put their message IDs on different timelines. The Rust client
// reads the same variables in `opencode_util::time::now_ms`.
const start = Number(process.env.OPENCODE_DRIVE_NOW)
if (start) {
  const real = Date
  const since = Number(process.env.OPENCODE_DRIVE_SINCE) || real.now()
  const offset = start - since
  const now = () => real.now() + offset
  globalThis.Date = new Proxy(real, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new real(now()).toString(),
    get: (target, key, receiver) => (key === "now" ? now : Reflect.get(target, key, receiver)),
  })
}
