import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { Rpc } from "../util/rpc"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { WorkerConfig } from "../config/worker-config"
import z from "zod"

export namespace BackgroundWorkers {
  const log = Log.create({ service: "background.workers" })

  let validationWorker: Worker | null = null
  let prefetchWorker: Worker | null = null
  let validationClient: any = null
  let prefetchClient: any = null
  let config: {
    validation: WorkerConfig.BackgroundValidationInfo
    prefetch: WorkerConfig.PrefetchWorkerInfo
  } | null = null

  // Events for UI
  const ValidationStateEvent = Bus.event("validation.state.updated", z.any())
  const PrefetchStateEvent = Bus.event("prefetch.state.updated", z.any())

  export async function init(userConfig?: {
    validation?: Partial<WorkerConfig.BackgroundValidationInfo>
    prefetch?: Partial<WorkerConfig.PrefetchWorkerInfo>
  }) {
    if (config) return

    const defaultValidation = WorkerConfig.BackgroundValidation.parse({})
    const defaultPrefetch = WorkerConfig.PrefetchWorker.parse({})

    config = {
      validation: { ...defaultValidation, ...userConfig?.validation },
      prefetch: { ...defaultPrefetch, ...userConfig?.prefetch },
    }

    log.info("Initializing background workers", {
      validation: config.validation.enabled,
      prefetch: config.prefetch.enabled,
    })

    if (config.validation.enabled) {
      await startValidationWorker()
    }

    if (config.prefetch.enabled) {
      await startPrefetchWorker()
    }

    // Subscribe to file watcher events
    Bus.subscribe(FileWatcher.Event.Updated, onFileChange)

    log.info("Background workers initialized")
  }

  async function startValidationWorker() {
    if (!config) return

    try {
      validationWorker = new Worker(new URL("../cli/cmd/tui/workers/background-validation.worker.ts", import.meta.url))

      validationWorker.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === "validation.state.update") {
          Bus.publish(ValidationStateEvent, message.state)
        }
      }

      validationClient = Rpc.client(validationWorker)

      await validationClient.call("init", {
        serverUrl: "http://localhost:3000",
        sessionID: Instance.project.id,
        commands: config.validation.commands,
        debounceMs: config.validation.debounceMs,
        include: config.validation.include,
        exclude: config.validation.exclude,
      })

      log.info("Validation worker started")
    } catch (error) {
      log.error("Failed to start validation worker", { error })
    }
  }

  async function startPrefetchWorker() {
    if (!config) return

    try {
      prefetchWorker = new Worker(new URL("../cli/cmd/tui/workers/prefetch.worker.ts", import.meta.url))

      prefetchWorker.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === "prefetch.state.update") {
          Bus.publish(PrefetchStateEvent, message.state)
        }
      }

      prefetchClient = Rpc.client(prefetchWorker)

      await prefetchClient.call("init", {
        serverUrl: "http://localhost:3000",
        sessionID: Instance.project.id,
        maxConcurrent: config.prefetch.maxConcurrent,
        maxCacheSize: config.prefetch.maxCacheSize,
        strategies: config.prefetch.strategies,
        workingDirectory: Instance.directory,
      })

      log.info("Prefetch worker started")
    } catch (error) {
      log.error("Failed to start prefetch worker", { error })
    }
  }

  async function onFileChange(event: { type: string; properties: { file: string; event: string } }) {
    const { file, event: changeType } = event.properties
    log.debug("File change detected", { file, changeType })

    if (validationClient && config?.validation.enabled) {
      try {
        await validationClient.call("enqueue", [file])
      } catch (error) {
        log.error("Failed to enqueue validation", { error, file })
      }
    }

    if (prefetchClient && config?.prefetch.enabled) {
      try {
        await prefetchClient.call("onFileAccess", file)
      } catch (error) {
        log.error("Failed to notify prefetch worker", { error, file })
      }
    }
  }

  export async function onFileRead(filePath: string) {
    if (prefetchClient && config?.prefetch.enabled) {
      try {
        await prefetchClient.call("onFileAccess", filePath)
      } catch (error) {
        log.error("Failed to notify prefetch of file read", { error, file: filePath })
      }
    }
  }

  export async function getValidationState() {
    if (!validationClient) return null
    try {
      return await validationClient.call("getState")
    } catch (error) {
      log.error("Failed to get validation state", { error })
      return null
    }
  }

  export async function getPrefetchState() {
    if (!prefetchClient) return null
    try {
      return await prefetchClient.call("getState")
    } catch (error) {
      log.error("Failed to get prefetch state", { error })
      return null
    }
  }

  export async function runValidationNow(files?: string[]) {
    if (!validationClient) return
    try {
      await validationClient.call("runNow", files)
    } catch (error) {
      log.error("Failed to run validation now", { error })
    }
  }

  export async function clearValidationQueue() {
    if (!validationClient) return
    try {
      await validationClient.call("clearQueue")
    } catch (error) {
      log.error("Failed to clear validation queue", { error })
    }
  }

  export async function clearPrefetchCache() {
    if (!prefetchClient) return
    try {
      await prefetchClient.call("clearCache")
    } catch (error) {
      log.error("Failed to clear prefetch cache", { error })
    }
  }

  export async function shutdown() {
    log.info("Shutting down background workers")

    if (validationClient && validationWorker) {
      try {
        await validationClient.call("shutdown")
        validationWorker.terminate()
        validationWorker = null
        validationClient = null
      } catch (error) {
        log.error("Failed to shutdown validation worker", { error })
      }
    }

    if (prefetchClient && prefetchWorker) {
      try {
        await prefetchClient.call("shutdown")
        prefetchWorker.terminate()
        prefetchWorker = null
        prefetchClient = null
      } catch (error) {
        log.error("Failed to shutdown prefetch worker", { error })
      }
    }

    config = null
  }

  export function getConfig() {
    return config
  }

  export function updateConfig(newConfig: {
    validation?: Partial<WorkerConfig.BackgroundValidationInfo>
    prefetch?: Partial<WorkerConfig.PrefetchWorkerInfo>
  }) {
    if (!config) return

    const oldConfig = { ...config }
    config = {
      validation: { ...config.validation, ...newConfig.validation },
      prefetch: { ...config.prefetch, ...newConfig.prefetch },
    }

    if (oldConfig.validation.enabled !== config.validation.enabled) {
      if (config.validation.enabled) {
        startValidationWorker()
      } else if (validationClient && validationWorker) {
        validationClient.call("shutdown")
        validationWorker.terminate()
        validationWorker = null
        validationClient = null
      }
    }

    if (oldConfig.prefetch.enabled !== config.prefetch.enabled) {
      if (config.prefetch.enabled) {
        startPrefetchWorker()
      } else if (prefetchClient && prefetchWorker) {
        prefetchClient.call("shutdown")
        prefetchWorker.terminate()
        prefetchWorker = null
        prefetchClient = null
      }
    }
  }
}
