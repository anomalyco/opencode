import { Context } from "../util/context"
import { Sandbox } from "./provider"
import { createLocalProvider } from "./local"
import { createModalProvider } from "./modal"
import { createKubernetesProvider } from "./kubernetes"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "sandbox" })

interface SandboxContext {
  instance: Sandbox.Instance | null
  provider: Sandbox.Provider
}

const context = Context.create<SandboxContext>("sandbox")
const sessionSandboxes = new Map<string, Sandbox.Instance>()

let defaultProvider: Sandbox.Provider | null = null

async function getProvider(): Promise<Sandbox.Provider> {
  if (defaultProvider) return defaultProvider

  const config = await Config.get()
  const providerType = config.sandbox?.provider ?? "local"

  switch (providerType) {
    case "modal":
      defaultProvider = createModalProvider(config.sandbox?.modal?.appName)
      break
    case "kubernetes":
      defaultProvider = createKubernetesProvider({
        namespace: config.sandbox?.kubernetes?.namespace,
        defaultImage: config.sandbox?.kubernetes?.image,
      })
      break
    case "local":
    default:
      defaultProvider = createLocalProvider()
      break
  }

  Sandbox.registerProvider(defaultProvider)
  return defaultProvider
}

export const SandboxContext = {
  async provide<R>(fn: () => R): Promise<R> {
    const provider = await getProvider()
    return context.provide({ instance: null, provider }, fn)
  },

  async getOrCreateForSession(sessionId: string): Promise<Sandbox.Instance> {
    const existing = sessionSandboxes.get(sessionId)
    if (existing) {
      const status = await existing.getStatus()
      if (status === "running") {
        return existing
      }
      sessionSandboxes.delete(sessionId)
    }

    const provider = await getProvider()
    const config = await Config.get()

    log.info("creating sandbox for session", { sessionId, provider: provider.type })

    const instance = await provider.create({
      sessionId,
      projectId: Instance.project.id,
      workdir: Instance.directory,
      timeout: config.sandbox?.modal?.timeout,
      image: config.sandbox?.modal?.image ?? config.sandbox?.kubernetes?.image,
    } as Sandbox.Config)

    sessionSandboxes.set(sessionId, instance)
    return instance
  },

  async getForSession(sessionId: string): Promise<Sandbox.Instance | undefined> {
    return sessionSandboxes.get(sessionId)
  },

  async terminateForSession(sessionId: string): Promise<void> {
    const instance = sessionSandboxes.get(sessionId)
    if (instance) {
      log.info("terminating sandbox for session", { sessionId })
      await instance.terminate()
      sessionSandboxes.delete(sessionId)
    }
  },

  async terminateAll(): Promise<void> {
    log.info("terminating all sandboxes", { count: sessionSandboxes.size })
    for (const [sessionId, instance] of sessionSandboxes) {
      try {
        await instance.terminate()
      } catch (err) {
        log.error("failed to terminate sandbox", { sessionId, error: err })
      }
    }
    sessionSandboxes.clear()
  },

  get provider(): Sandbox.Provider {
    return context.use().provider
  },

  get current(): Sandbox.Instance | null {
    return context.use().instance
  },

  isRemote(): boolean {
    const provider = context.use().provider
    return provider.type !== "local"
  },
}
