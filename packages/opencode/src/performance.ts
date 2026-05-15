import * as Log from "@opencode-ai/core/util/log"

const perf = globalThis as typeof globalThis & {
  __opencode_perf_boot__?: bigint
  __opencode_perf_tui_logged__?: boolean
}

if (!perf.__opencode_perf_boot__) {
  perf.__opencode_perf_boot__ = process.hrtime.bigint()
}

export function getBootStart() {
  return perf.__opencode_perf_boot__
}

export function sinceBootMs() {
  const started = getBootStart()
  if (!started) return
  return Number((process.hrtime.bigint() - started) / BigInt(1000000))
}

export function logInitialTuiLaunch() {
  if (perf.__opencode_perf_tui_logged__) return
  const elapsed = sinceBootMs()
  if (elapsed === undefined) return
  perf.__opencode_perf_tui_logged__ = true
  Log.Default.info("perf", {
    event: "tui_ready",
    startup_ms: elapsed,
  })
  if (process.env.OPENCODE_PERF_STDERR === "1") {
    process.stderr.write(`opencode perf: tui-ready ${elapsed}ms\n`)
  }
}
