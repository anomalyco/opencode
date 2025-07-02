import { z } from "zod"
import { App } from "../app/app"
import { Bus } from "../bus"
import { Session } from "../session"
import { Message } from "../session/message"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import { Config } from "../config/config"
import { ActivitySupportedPlatform, Client } from "@xhayper/discord-rpc"
import path from "path"

export namespace Discord {
  const log = Log.create({ service: "discord" })
  const DEFAULT_APPLICATION_ID = "1388540337164910712"

  export type Config = NonNullable<Config.Info["discord"]>

  interface PresenceData {
    details?: string
    state?: string
    startTimestamp?: number
    largeImageKey?: string
    largeImageText?: string
    smallImageKey?: string
    smallImageText?: string
    supportedPlatforms?: (
      | ActivitySupportedPlatform
      | `${ActivitySupportedPlatform}`
    )[]
    instance?: boolean
  }

  const state = App.state(
    "discord",
    async () => {
      const configData = await Config.get()
      const config = configData.discord

      if (!config?.enabled) {
        return {
          client: null as Client | null,
          isConnected: false,
          currentSession: null as Session.Info | null,
          currentModel: null as string | null,
          sessionStartTime: null as number | null,
          retryTimeout: null as NodeJS.Timeout | null,
          retryCount: 0,
          config: null as Config | null,
          activityInterval: null as NodeJS.Timeout | null,
        }
      }

      log.info("Initializing Discord Rich Presence", {
        enabled: config.enabled,
        applicationId: config.applicationId || DEFAULT_APPLICATION_ID,
        showModel: config.showModel,
        showProject: config.showProject,
      })

      const appState = {
        client: null as Client | null,
        isConnected: false,
        currentSession: null as Session.Info | null,
        currentModel: null as string | null,
        sessionStartTime: null as number | null,
        retryTimeout: null as NodeJS.Timeout | null,
        retryCount: 0,
        config,
        activityInterval: null as NodeJS.Timeout | null,
      }

      attemptConnection(appState, config)
      return appState
    },
    async (state) => {
      if (state.retryTimeout) {
        clearTimeout(state.retryTimeout)
        state.retryTimeout = null
      }

      if (state.activityInterval) {
        clearInterval(state.activityInterval)
        state.activityInterval = null
      }

      if (state.client) {
        try {
          await state.client.destroy()
          log.info("Discord Rich Presence disconnected")
        } catch (error) {
          log.error("Error disconnecting Discord client", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        state.client = null
        state.isConnected = false
      }
    },
  )

  export const ConnectionError = NamedError.create(
    "DiscordConnectionError",
    z.object({
      message: z.string(),
    }),
  )

  export async function init() {
    return state()
  }

  async function attemptConnection(
    appState: Awaited<ReturnType<typeof state>>,
    config: Config,
  ) {
    const applicationId = config.applicationId || DEFAULT_APPLICATION_ID

    log.info("Attempting Discord Rich Presence connection", {
      applicationId,
      attempt: appState.retryCount + 1,
      transport: "ipc",
    })

    try {
      if (appState.client) {
        try {
          await appState.client.destroy()
        } catch (e) {
          // Ignore cleanup errors
        }
        appState.client = null
      }

      appState.client = new Client({
        clientId: applicationId,
        transport: { type: "ipc" },
      })

      appState.client.on("ready", () => {
        log.info("Discord Rich Presence connected successfully", {
          user: appState.client?.user?.username || "unknown",
        })
        appState.isConnected = true
        appState.retryCount = 0

        if (!appState.sessionStartTime) {
          appState.sessionStartTime = Date.now()
        }

        startActivityUpdates(appState, config)
        setupEventListeners(appState, config)
      })

      appState.client.on("join", (secret: string) => {
        log.info("Discord join request received", { secret })
        if (secret.startsWith("http")) {
          import("open")
            .then((open) => open.default(secret))
            .catch(() => {
              log.warn("Failed to open share URL", { url: secret })
            })
        }
      })
      appState.client.on("disconnected", () => {
        log.info("Discord Rich Presence disconnected")
        appState.isConnected = false
        scheduleRetry(appState, config)
      })

      appState.client.on("error", (error: Error) => {
        log.error("Discord RPC client error", {
          error: error.message,
          code: (error as any).code,
          stack: error.stack,
        })
        appState.isConnected = false
        scheduleRetry(appState, config)
      })

      const loginPromise = appState.client.login()
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Login timeout after 10 seconds")),
          10000,
        )
      })

      await Promise.race([loginPromise, timeoutPromise])
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const errorCode = (error as any)?.code

      log.warn("Discord Rich Presence connection failed", {
        error: errorMessage,
        code: errorCode,
        attempt: appState.retryCount + 1,
        applicationId,
      })

      if (appState.client) {
        try {
          await appState.client.destroy()
        } catch (e) {
        }
        appState.client = null
      }

      scheduleRetry(appState, config)
    }
  }

  function startActivityUpdates(
    appState: Awaited<ReturnType<typeof state>>,
    config: Config,
  ) {
    if (appState.activityInterval) {
      clearInterval(appState.activityInterval)
    }

    setActivity(appState, config)

    appState.activityInterval = setInterval(() => {
      setActivity(appState, config)
    }, 15000)
  }

  async function setActivity(
    appState: Awaited<ReturnType<typeof state>>,
    config: Config,
  ) {
    if (!appState.client || !appState.isConnected) return

    const presence = buildPresence(appState, config)
    await appState.client?.user?.setActivity(presence)
  }
  function setupEventListeners(
    appState: Awaited<ReturnType<typeof state>>,
    _config: Config,
  ) {
    if (appState.retryCount > 0) return

    Bus.subscribe(Session.Event.Updated, (event) => {
      appState.currentSession = event.properties.info
      if (!appState.sessionStartTime) {
        appState.sessionStartTime = Date.now()
      }
      setActivity(appState, _config)
    })

    Bus.subscribe(Message.Event.Updated, (event) => {
      const message = event.properties.info
      if (message.role === "assistant" && message.metadata?.assistant) {
        const newModel = `${message.metadata.assistant.providerID}/${message.metadata.assistant.modelID}`
        if (newModel !== appState.currentModel) {
          appState.currentModel = newModel
        }
      }
    })
  }

  function scheduleRetry(
    appState: Awaited<ReturnType<typeof state>>,
    config: Config,
  ) {
    if (appState.retryCount >= 3) {
      log.info(
        "Discord Rich Presence: Maximum retry attempts reached, giving up",
      )
      return
    }

    appState.retryCount++
    const delay = Math.min(5000 * appState.retryCount, 30000)

    log.info(
      `Discord Rich Presence: Retrying in ${delay / 1000}s (attempt ${appState.retryCount + 1}/4)`,
    )

    appState.retryTimeout = setTimeout(() => {
      attemptConnection(appState, config)
    }, delay)
  }

  function buildPresence(
    appState: Awaited<ReturnType<typeof state>>,
    config: Config,
  ): PresenceData {
    const app = App.info()

    const presence: PresenceData = {
      startTimestamp: appState.sessionStartTime || Date.now(),
      largeImageKey: "opencode",
      largeImageText: "opencode AI Assistant",
      instance: false,
      supportedPlatforms: ["web", "ios", "android"],
    }

    if (config.customStatus) {
      presence.details = config.customStatus
    } else if (config.showProject) {
      const projectName = path.basename(app.path.cwd)
      presence.details = `Working on: ${projectName}`
    } else {
      presence.details = "Using opencode"
    }

    if (config.showModel && appState.currentModel) {
      const [, model] = appState.currentModel.split("/")
      presence.state = `Using ${model || appState.currentModel}`
    } else {
      presence.state = "Using opencode.ai"
    }

    presence.smallImageKey = "terminal"
    presence.smallImageText = "Coding"

    return presence
  }
}
