import { Service } from "@opencode-ai/client/effect"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import { Server } from "../services/server"
import { waitForCatalogReady } from "./catalog.shared"
import { INTERACTIVE_INPUT_ERROR, resolveInteractiveStdin } from "./runtime.stdin"
import type { RunInput, RunTuiConfig } from "./types"

export type MiniCommandInput = {
  server: Server.Resolved
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  prompt?: string
  replay?: boolean
  replayLimit?: number
  demo?: boolean
  tuiConfig?: RunTuiConfig | Promise<RunTuiConfig>
}

type Session = Awaited<ReturnType<OpenCodeClient["session"]["get"]>>
export async function runMini(input: MiniCommandInput) {
  validate(input)
  const initialInput = mergeInput(process.stdin.isTTY ? undefined : await Bun.stdin.text(), input.prompt)
  const runtimeTask = import("./runtime")
  const directory = localDirectory()

  try {
    const sdk = OpenCode.make({
      baseUrl: input.server.endpoint.url,
      headers: Service.headers(input.server.endpoint),
    })
    const model = parseModel(input.model)
    let agentTask: Promise<string | undefined> | undefined
    const resolveAgent = () => {
      agentTask ??= validateAgent(sdk, directory, input.agent)
      return agentTask
    }
    const resolveSession = async () => {
      const [agent, selected] = await Promise.all([
        resolveAgent(),
        selectSession(sdk, directory, input),
      ])
      const readyModel =
        model ?? (selected?.model ? { providerID: selected.model.providerID, modelID: selected.model.id } : undefined)
      if (readyModel) await waitForCatalogReady({ sdk, directory, model: readyModel })
      const session = selected ?? (await createSession(sdk, directory, agent, model))
      return { id: session.id, title: session.title, resume: selected !== undefined }
    }
    const create = (
      _sdk: OpenCodeClient,
      next: { agent: string | undefined; model: RunInput["model"]; variant: string | undefined },
    ) => createSession(sdk, directory, next.agent, next.model, next.variant)
    const runtime = await runtimeTask
    await runtime.runInteractiveDeferredMode({
      sdk,
      directory,
      resolveAgent,
      session: resolveSession,
      createSession: create,
      agent: input.agent,
      model,
      variant: undefined,
      files: [],
      initialInput,
      thinking: true,
      replay: input.replay ?? true,
      replayLimit: input.replayLimit,
      demo: input.demo,
      tuiConfig: input.tuiConfig,
    })
  } catch (error) {
    if (error instanceof Error && error.message === INTERACTIVE_INPUT_ERROR) fail(error.message)
    throw error
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
  resolveInteractiveStdin().cleanup?.()
}

function localDirectory(): string {
  const root = process.env.PWD ?? process.cwd()
  try {
    process.chdir(root)
    return process.cwd()
  } catch {
    fail(`Failed to change directory to ${root}`)
  }
}

function parseModel(value?: string): RunInput["model"] {
  if (!value) return
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) fail("--model must use the format provider/model")
  return { providerID, modelID }
}

async function validateAgent(sdk: OpenCodeClient, directory: string, name?: string) {
  if (!name) return
  const deadline = Date.now() + 5_000
  let agents: Awaited<ReturnType<OpenCodeClient["agent"]["list"]>> | undefined
  while (Date.now() < deadline) {
    agents = await sdk.agent.list({ location: { directory } }).catch(() => undefined)
    const agent = agents?.data.find((item) => item.id === name)
    if (agent?.mode === "subagent") {
      warning(`agent "${name}" is a subagent, not a primary agent. Falling back to default agent`)
      return
    }
    if (agent) return name
    await Bun.sleep(25)
  }
  if (!agents) {
    warning("failed to list agents. Falling back to default agent")
    return
  }
  warning(`agent "${name}" not found. Falling back to default agent`)
}

async function selectSession(sdk: OpenCodeClient, directory: string, input: MiniCommandInput, preselected?: Session) {
  const selected =
    preselected ??
    (input.session
      ? await sdk.session.get({ sessionID: input.session }).catch(() => undefined)
      : input.continue
        ? await sdk.session
            .list({ directory, parentID: null, limit: 1, order: "desc" })
            .then((result) => result.data[0])
        : undefined)
  if (input.session && !selected) fail("Session not found")
  if (!selected) return
  if (!input.fork) return selected
  return sdk.session.fork({ sessionID: selected.id })
}

async function createSession(
  sdk: OpenCodeClient,
  directory: string,
  agent: string | undefined,
  model: RunInput["model"],
  variant?: string,
): Promise<Session> {
  if (model) await waitForCatalogReady({ sdk, directory, model })
  return sdk.session.create({
    agent,
    model: model ? { providerID: model.providerID, id: model.modelID, variant } : undefined,
    location: { directory },
  })
}

function warning(message: string) {
  process.stderr.write(`\x1b[93m\x1b[1m!\x1b[0m ${message}\n`)
}

function fail(message: string): never {
  process.stderr.write(`\x1b[91m\x1b[1mError: \x1b[0m${message}\n`)
  process.exit(1)
}
