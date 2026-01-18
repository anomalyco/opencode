import type { Hooks } from "./index"

export interface RalphLoopState {
  sessionID: string
  prompt: string
  completionPromise?: string
  maxIterations: number
  iterationCount: number
  cancelled: boolean
  lastUserID?: string
}

export interface RalphLoopOptions {
  prompt?: string
  completionPromise?: string
  maxIterations?: number
}

const DEFAULT_MAX_ITERATIONS = 20
const ABSOLUTE_MAX = 100

let ralphState: Map<string, RalphLoopState> | undefined

function getRalphState(): Map<string, RalphLoopState> {
  if (!ralphState) {
    ralphState = new Map()
  }
  return ralphState
}

export function registerLoop(
  sessionID: string,
  promptOrOptions?: string | RalphLoopOptions,
  maxIterations?: number,
): RalphLoopState {
  const state = getRalphState()

  let prompt: string = ""
  let completionPromise: string | undefined
  let maxIter = DEFAULT_MAX_ITERATIONS

  if (typeof promptOrOptions === "string") {
    prompt = promptOrOptions
    if (maxIterations !== undefined) {
      maxIter = maxIterations
    }
  } else if (promptOrOptions) {
    if (promptOrOptions.prompt !== undefined) {
      prompt = promptOrOptions.prompt
    }
    if (promptOrOptions.completionPromise !== undefined) {
      completionPromise = promptOrOptions.completionPromise
    }
    if (promptOrOptions.maxIterations !== undefined) {
      maxIter = promptOrOptions.maxIterations
    }
  }

  const newLoop: RalphLoopState = {
    sessionID,
    prompt,
    completionPromise,
    maxIterations: Math.min(maxIter, ABSOLUTE_MAX),
    iterationCount: 0,
    cancelled: false,
  }
  state.set(sessionID, newLoop)
  return newLoop
}

export function cancelLoop(sessionID: string): boolean {
  const state = getRalphState()
  const loop = state.get(sessionID)
  if (!loop) return false
  loop.cancelled = true
  state.delete(sessionID)
  return true
}

export function isLoopActive(sessionID: string): boolean {
  const state = getRalphState()
  const loop = state.get(sessionID)
  return loop !== undefined && !loop.cancelled
}

export function getLoopState(sessionID: string): RalphLoopState | undefined {
  const state = getRalphState()
  return state.get(sessionID)
}

export function clearRalphLoop() {
  ralphState = undefined
}

export { parseRalphLoopArgs }

function parseRalphLoopArgs(args: string[]): RalphLoopOptions & { cancel: boolean } {
  const promptTokens: string[] = []
  let completionPromise: string | undefined
  let maxIterations: number | undefined
  let cancel = false
  const maxIterationsError = "Invalid max iterations: expected a positive integer"

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--") {
      promptTokens.push(...args.slice(i + 1))
      break
    }
    if (arg === "--cancel" || arg === "-c") {
      cancel = true
      continue
    }
    if (arg === "--completion-promise" || arg === "-p") {
      completionPromise = args[++i]
      continue
    }
    if (arg === "--max-iterations" || arg === "-m") {
      const val = args[++i]
      if (!val || !/^\d+$/.test(val)) {
        throw new Error(maxIterationsError)
      }
      const parsed = Number(val)
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(maxIterationsError)
      }
      maxIterations = parsed
      continue
    }
    promptTokens.push(arg)
  }

  const prompt = promptTokens.length ? promptTokens.join(" ") : undefined
  return { prompt, completionPromise, maxIterations, cancel }
}

export function formatRalphLoopPrompt(loop: RalphLoopState): string {
  const status = `Ralph Loop ${loop.iterationCount}/${loop.maxIterations}`
  const completion = loop.completionPromise
    ? `\n\nIf you didn't manage to change or improve anything say <promise>${loop.completionPromise}</promise> to stop. Do not lie.`
    : ""
  return `${status}\n\n${loop.prompt}${completion}`
}

function checkCompletionMatch(assistantText: string, completionPromise: string): boolean {
  const expectedTag = `<promise>${completionPromise}</promise>`.toLowerCase()
  return assistantText.toLowerCase().includes(expectedTag)
}

export const RalphLoop: Hooks = {
  "chat.waiting": async (input, output) => {
    const state = getRalphState()
    const existing = state.get(input.sessionID)

    if (!existing || existing.cancelled) {
      state.delete(input.sessionID)
      return
    }

    const nextIteration = existing.iterationCount + 1
    if (nextIteration > existing.maxIterations || nextIteration > ABSOLUTE_MAX) {
      state.delete(input.sessionID)
      return
    }

    if (existing.completionPromise && checkCompletionMatch(input.assistantText, existing.completionPromise)) {
      state.delete(input.sessionID)
      return
    }

    existing.iterationCount = nextIteration
    const prompt = formatRalphLoopPrompt(existing)
    output.injectedTexts.push(prompt)
  },
}
