import { Log } from "./log"

export namespace EventLoop {
  export async function wait() {
    return new Promise<void>((resolve) => {
      const check = () => {
        const active = [...(process as any)._getActiveHandles(), ...(process as any)._getActiveRequests()]
        Log.Default.info("eventloop", {
          active,
        })
        if ((process as any)._getActiveHandles().length === 0 && (process as any)._getActiveRequests().length === 0) {
          resolve()
        } else {
          setImmediate(check)
        }
      }
      check()
    })
  }
}
