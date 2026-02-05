import { Log } from "./log"

export namespace EventLoop {
  export async function wait() {
    return new Promise<void>((resolve) => {
      const check = () => {
        const proc = process as NodeJS.Process & {
          _getActiveHandles?: () => unknown[]
          _getActiveRequests?: () => unknown[]
        }
        const handles = proc._getActiveHandles?.() ?? []
        const requests = proc._getActiveRequests?.() ?? []
        const active = [...handles, ...requests]
        Log.Default.info("eventloop", {
          active,
        })
        if (handles.length === 0 && requests.length === 0) {
          resolve()
        } else {
          setImmediate(check)
        }
      }
      check()
    })
  }
}
