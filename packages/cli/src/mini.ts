import { Service, type Endpoint } from "@opencode-ai/client/effect/service"
import { ClientError, OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { MiniFrontendInput } from "@opencode-ai/tui/mini"
import { setTimeout } from "node:timers/promises"
import { waitForCatalogReady } from "./services/catalog"
import { readStdin } from "./util/io"
import { createMiniHost, INTERACTIVE_INPUT_ERROR, usingInteractiveStdin } from "./mini-host"
import { parseSessionTargetModel, resolveSessionTarget, type SessionTargetPreparation } from "./session-target"

export type MiniCommandInput = {
  server: {
    endpoint: Endpoint
    reconnect?: (signal: AbortSignal) => Promise<Endpoint>
  }
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  prompt?: string
  replay?: boolean
  replayLimit?: number
  demo?: boolean
  tuiConfig?: MiniFrontendInput["tuiConfig"]
}

type Model = MiniFrontendInput["model"]

class MiniInputError extends Error {}

export async function runMini(input: MiniCommandInput) {
  try {
    validate(input)
    const result = await usingInteractiveStdin(async (terminal) => {
      const initialInput = mergeInput(process.stdin.isTTY ? undefined : await readStdin(), input.prompt)
      const frontendTask = import("@opencode-ai/tui/mini")
      const directory = localDirectory()
      const connection = createMiniConnection(input.server)
      const sdk = connection.sdk
      const requested = parseModel(input.model)
      const model = requested ? { providerID: requested.providerID, modelID: requested.id } : undefined
      const prepare = prepareTarget(input.agent)
      const resolveTarget = async (initial: OpenCodeClient, signal: AbortSignal) => {
        const resolved = await resolveMiniTarget({
          sdk: initial,
          reconnect: connection.reconnect,
          signal,
          resolve: (client) =>
            resolveSessionTarget({
              client,
              location: { directory },
              continue: input.continue,
              session: input.session,
              fork: input.fork,
              model: requested,
              agent: input.agent,
              prepare,
              signal,
            }).catch((error) => {
              if (error instanceof Error && error.message === "Session not found")
                throw new MiniInputError(error.message)
              throw error
            }),
        })
        const target = resolved.value
        return {
          sdk: resolved.sdk,
          sessionID: target.session.id,
          sessionTitle: target.session.title,
          location: target.location,
          model: target.model ? { providerID: target.model.providerID, modelID: target.model.id } : undefined,
          variant: target.model?.variant,
          agent: target.agent,
          resume: target.resume,
        }
      }
      const create = (
        client: OpenCodeClient,
        next: {
          location: { directory: string; workspaceID?: string }
          agent: string | undefined
          model: Model
          variant: string | undefined
        },
        signal?: AbortSignal,
      ) =>
        resolveSessionTarget({
          client,
          location: { directory: next.location.directory, workspace: next.location.workspaceID },
          agent: next.agent,
          model: next.model
            ? { providerID: next.model.providerID, id: next.model.modelID, variant: next.variant }
            : undefined,
          prepare,
          signal,
        }).then((target) => ({
          sessionID: target.session.id,
          sessionTitle: target.session.title,
          location: target.location,
          model: target.model ? { providerID: target.model.providerID, modelID: target.model.id } : undefined,
          variant: target.model?.variant,
          agent: target.agent,
          resume: false,
        }))
      const frontend = await frontendTask
      return frontend.runMiniFrontend({
        host: createMiniHost({ terminal, directory }),
        sdk,
        directory,
        target: resolveTarget,
        reconnect: connection.reconnect,
        createSession: create,
        agent: input.agent,
        model,
        variant: requested?.variant,
        files: [],
        initialInput,
        replay: input.replay ?? true,
        replayLimit: input.replayLimit,
        demo: input.demo,
        tuiConfig: input.tuiConfig,
      })
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  } catch (error) {
    if (error instanceof MiniInputError || (error instanceof Error && error.message === INTERACTIVE_INPUT_ERROR))
      fail(error.message)
    throw error
  }
}

/** @internal Exported for CLI boundary tests. */
export function createMiniConnection(input: MiniCommandInput["server"]) {
  const make = (endpoint: Endpoint) =>
    OpenCode.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
    })
  const reconnect = input.reconnect
  return {
    sdk: make(input.endpoint),
    reconnect: reconnect
      ? async (signal: AbortSignal) => {
          const endpoint = await reconnect(signal)
          return make(endpoint)
        }
      : undefined,
  }
}

/** @internal Exported for reconnect lifecycle tests. */
export async function resolveMiniTarget<A>(input: {
  sdk: OpenCodeClient
  reconnect?: (signal: AbortSignal) => Promise<OpenCodeClient>
  signal: AbortSignal
  resolve: (sdk: OpenCodeClient) => Promise<A>
}) {
  let sdk = input.sdk
  while (true) {
    try {
      return { sdk, value: await input.resolve(sdk) }
    } catch (error) {
      if (!input.reconnect || !(error instanceof ClientError) || error.reason !== "Transport") throw error
      while (true) {
        try {
          sdk = await input.reconnect(input.signal)
          break
        } catch (resolveError) {
          if (input.signal.aborted) throw resolveError
          await setTimeout(250, undefined, { signal: input.signal })
        }
      }
    }
  }
}

export function validateMiniTerminal() {
  if (!process.stdout.isTTY) fail("opencode mini requires a TTY stdout")
}

/** @internal Exported for testing. */
export function mergeInput(piped: string | undefined, prompt: string | undefined) {
  if (!prompt) return piped || undefined
  if (!piped) return prompt
  return piped + "\n" + prompt
}

function validate(input: MiniCommandInput) {
  validateMiniTerminal()
  if (input.replayLimit !== undefined && (!Number.isInteger(input.replayLimit) || input.replayLimit <= 0)) {
    fail("--replay-limit must be a positive integer")
  }
  if (input.fork && !input.continue && !input.session) fail("--fork requires --continue or --session")
}

function localDirectory(): string {
  const root = process.env.PWD ?? process.cwd()
  try {
    process.chdir(root)
    return process.cwd()
  } catch {
    throw new MiniInputError(`Failed to change directory to ${root}`)
  }
}

function parseModel(value?: string) {
  try {
    return parseSessionTargetModel(value)
  } catch {
    throw new MiniInputError("--model must use the format provider/model[#variant]")
  }
}

function prepareTarget(requestedAgent?: string): SessionTargetPreparation {
  return async (input) => {
    if (input.model)
      await waitForCatalogReady({
        sdk: input.client,
        directory: input.location.directory,
        workspace: input.location.workspaceID,
        model: { providerID: input.model.providerID, modelID: input.model.id },
        signal: input.signal,
      })
    return {
      model: input.model,
      agent: requestedAgent
        ? await validateAgent(
            input.client,
            input.location.directory,
            input.location.workspaceID,
            requestedAgent,
            input.signal,
          )
        : input.agent,
    }
  }
}

async function validateAgent(
  sdk: OpenCodeClient,
  directory: string,
  workspace: string | undefined,
  name?: string,
  signal?: AbortSignal,
) {
  if (!name) return
  const deadline = Date.now() + 5_000
  let agents: Awaited<ReturnType<OpenCodeClient["agent"]["list"]>> | undefined
  while (Date.now() < deadline && !signal?.aborted) {
    agents = await sdk.agent.list({ location: { directory, workspace } }, { signal }).catch((error) => {
      if (signal && error instanceof ClientError && error.reason === "Transport") throw error
      return undefined
    })
    const agent = agents?.data.find((item) => item.id === name)
    if (agent?.mode === "subagent") {
      warning(`agent "${name}" is a subagent, not a primary agent. Falling back to default agent`)
      return
    }
    if (agent) return name
    await setTimeout(25, undefined, { signal }).catch(() => {})
  }
  if (signal?.aborted) return
  if (!agents) {
    warning("failed to list agents. Falling back to default agent")
    return
  }
  warning(`agent "${name}" not found. Falling back to default agent`)
}

function warning(message: string) {
  process.stderr.write(`\x1b[93m\x1b[1m!\x1b[0m ${message}\n`)
}

function fail(message: string): never {
  process.stderr.write(`\x1b[91m\x1b[1mError: \x1b[0m${message}\n`)
  process.exit(1)
}
