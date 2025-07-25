import { Global } from "../global"
import { Installation } from "../installation"
import path from "path"
import { BufferedWriter } from "./buffered-writer"
import { RequestInterceptor } from "./request-interceptor"

export namespace Trace {
  let interceptor: RequestInterceptor.FetchInterceptor | null = null
  let writerManager: BufferedWriter.Manager | null = null

  export function init(): void {
    if (!Installation.isDev()) return

    // Initialize writer manager
    writerManager = new BufferedWriter.Manager()
    
    // Get buffered writer for fetch logs
    const logPath = path.join(Global.Path.data, "log", "fetch.log")
    const writer = writerManager.getWriter(logPath, {
      bufferSize: 50,
      flushInterval: 1000,
      autoFlush: true,
    })

    // Create and install fetch interceptor
    interceptor = new RequestInterceptor.FetchInterceptor(writer, {
      logRequests: true,
      logResponses: true,
      logResponseBodies: true,
      maxBodyLength: 1024 * 1024, // 1MB
    })

    interceptor.install()
  }

  export async function shutdown(): Promise<void> {
    if (interceptor) {
      interceptor.uninstall()
      interceptor = null
    }

    if (writerManager) {
      await writerManager.closeAll()
      writerManager = null
    }
  }

  export async function flush(): Promise<void> {
    if (writerManager) {
      await writerManager.flushAll()
    }
  }
}
