import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, session } from "electron"

import { Deferred, Effect, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL } from "./constants"
import { broadcastServerReconnect, registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { setupAutoUpdater } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"

const APP_NAMES: Record<string, string> = {
  dev: "Basalt Dev",
  beta: "Basalt Beta",
  prod: "Basalt",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null
let appQuitting = false
let restartEnabled = false
let restartInProgress: Promise<void> | undefined
let sidecarGeneration = 0
let latestServerReady: ServerReadyData | undefined

const pendingDeepLinks: string[] = []

const SIDECAR_RESTART_DELAY = 1000
const SIDECAR_MAX_RESTART_ATTEMPTS = 5
const SIDECAR_RESTART_BACKOFF = 2000
const SIDECAR_RESTART_HEALTH_TIMEOUT = 3000

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar(intentional = true) {
  if (intentional) restartEnabled = false
  // 即使进程仍在启动或重试等待中，也要先使当前代际失效并阻止后续拉起。
  sidecarGeneration++
  const current = server
  server = null
  if (!current) return
  await current.stop()
}

async function pickFreePort(useConfiguredPort: boolean): Promise<number> {
  const fromEnv = useConfiguredPort ? process.env.OPENCODE_PORT : undefined
  if (fromEnv !== undefined) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address()
      if (typeof address !== "object" || !address) {
        srv.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      srv.close(() => resolve(port))
    })
  })
}

async function startSidecar(useConfiguredPort: boolean): Promise<{ data: ServerReadyData; health: Promise<void> }> {
  if (server) throw new Error("Cannot start sidecar while another sidecar is active")
  const generation = ++sidecarGeneration
  const port = await pickFreePort(useConfiguredPort)
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()
  let running = false
  let exited = false

  logger.log("spawning sidecar", { url })
  const { listener, health } = await spawnLocalServer(hostname, port, password, {
    userDataPath: app.getPath("userData"),
    onStdout: (message) => writeLog("server", "stdout", { message }),
    onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
    onExit: (code) => {
      exited = true
      writeLog("utility", "sidecar exited", { code }, "warn")
      if (generation !== sidecarGeneration) return
      server = null
      if (running && restartEnabled && !appQuitting) restartSidecar()
    },
  })
  if (exited) {
    await listener.stop()
    throw new Error("Sidecar exited before startup completed")
  }
  if (generation !== sidecarGeneration || appQuitting) {
    await listener.stop()
    throw new Error("Sidecar start superseded")
  }
  server = listener
  running = true

  return {
    data: { url, username: "opencode", password },
    health: health.wait,
  }
}

function restartSidecar() {
  if (appQuitting || !restartEnabled) return
  if (restartInProgress) return

  let becameHealthy = false
  restartInProgress = (async () => {
    for (let attempt = 1; attempt <= SIDECAR_MAX_RESTART_ATTEMPTS; attempt++) {
      const wait = SIDECAR_RESTART_DELAY + (attempt - 1) * SIDECAR_RESTART_BACKOFF
      logger.log("sidecar restart scheduled", { attempt, wait })
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (appQuitting || !restartEnabled) return

      try {
        const { data, health } = await startSidecar(false)
        await waitForHealth(health, SIDECAR_RESTART_HEALTH_TIMEOUT)
        becameHealthy = true
        latestServerReady = data
        logger.log("sidecar restarted", { url: data.url })
        broadcastServerReconnect(data)
        return
      } catch (error) {
        logger.error("sidecar restart failed", { attempt, error: error instanceof Error ? error.message : String(error) })
        await killSidecar(false).catch((stopError) => logger.error("failed to stop unhealthy sidecar", stopError))
      }
    }

    logger.error("sidecar restart attempts exhausted", { attempts: SIDECAR_MAX_RESTART_ATTEMPTS })
  })().finally(() => {
    restartInProgress = undefined
    // 健康检查后立即崩溃可能发生在当前 Promise 收尾前，此时补一次重启请求。
    if (becameHealthy && !server && restartEnabled && !appQuitting) restartSidecar()
  })
}

async function waitForHealth(health: Promise<void>, timeout: number) {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      health,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Sidecar health check timed out after ${timeout}ms`)), timeout)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "Basalt Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    appQuitting = true
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.exit(0)
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    appQuitting = true
    setAppQuitting()
    void stopSidecars()
  })

  app.on("will-quit", () => {
    appQuitting = true
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      appQuitting = true
      setAppQuitting()
      void stopSidecars().finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  // 开发端依赖由 Vite 预构建，清理 Chromium 持久缓存避免继续执行已删除的旧 chunk。
  if (!app.isPackaged) yield* Effect.promise(() => session.defaultSession.clearCache())

  if (!TEST_ONBOARDING) migrate()
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        if (latestServerReady) {
          logger.log("server ready", { url: latestServerReady.url })
          return latestServerReady
        }
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
  })
  registerWslIpcHandlers(wslServers)
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started")

    ensureLoopbackNoProxy()
    useEnvProxy()

    restartEnabled = true
    const { data, health } = yield* Effect.promise(() => startSidecar(true))
    latestServerReady = data
    yield* Deferred.succeed(serverReady, data)

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    // ready 消息已经表示监听完成，健康检查只做后台诊断，不能阻塞窗口最多 30 秒。
    void waitForHealth(health, 30_000).catch((error) => logger.error("sidecar health check failed", error))

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  const windows = restoreMainWindows()
  if (windows.length) {
    createMenu({
      trigger: (id) => {
        const win = getLastFocusedWindow()
        if (win) sendMenuCommand(win, id)
      },
      relaunch: () => {
        relaunch()
      },
    })
  }
})

Effect.runFork(main)
