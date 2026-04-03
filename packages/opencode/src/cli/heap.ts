import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Log } from "@/util/log"

const log = Log.create({ service: "heap" })
const MINUTE = 60_000
const LIMIT = 2 * 1024 * 1024 * 1024

export namespace Heap {
  let timer: Timer | undefined
  let lock = false

  export function start() {
    if (!Flag.OPENCODE_AUTO_HEAP_SNAPSHOT) return
    if (timer) return

    const run = async () => {
      if (lock) return

      const stat = process.memoryUsage()
      if (stat.rss <= LIMIT) return

      lock = true
      const file = path.join(
        Global.Path.log,
        `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
      )
      log.warn("heap usage exceeded limit", {
        rss: stat.rss,
        heap: stat.heapUsed,
        file,
      })

      await Promise.resolve()
        .then(() => writeHeapSnapshot(file))
        .catch((err) => {
          log.error("failed to write heap snapshot", {
            error: err instanceof Error ? err.message : String(err),
            file,
          })
        })

      lock = false
    }

    timer = setInterval(() => {
      void run()
    }, MINUTE)
    timer.unref?.()
  }

  export function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
    lock = false
  }
}
