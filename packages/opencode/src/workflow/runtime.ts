import type { WorkflowHelpers } from "./executor"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "workflow.runtime" })

export class WorkflowRuntimeError extends Error {
  constructor(message: string, public readonly script?: string) {
    super(message)
    this.name = "WorkflowRuntimeError"
  }
}

const FORBIDDEN_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s+/,
  /\bprocess\./,
  /\bglobalThis\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bchild_process\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
]

function validateScript(source: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(source)) {
      throw new WorkflowRuntimeError(`Forbidden pattern in workflow script: ${pattern.source}`, source)
    }
  }
}

const ALLOWED_GLOBALS = [
  "JSON", "Math", "Array", "Object", "String", "Number", "Boolean",
  "Date", "RegExp", "Map", "Set", "Promise", "Error",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "console",
]

export async function executeScript(
  source: string,
  helpers: WorkflowHelpers,
  args: string,
): Promise<unknown> {
  validateScript(source)

  const wrappedScript = `
return (async function(agent, parallel, sleep, args, ${ALLOWED_GLOBALS.join(", ")}) {
${source}
})
`

  // eslint-disable-next-line no-new-func
  const fn = new Function(wrappedScript)()
  const globalValues = ALLOWED_GLOBALS.map((name) => (globalThis as Record<string, unknown>)[name])

  log.info("running workflow script", { length: source.length })

  return await fn(helpers.agent, helpers.parallel, helpers.sleep, args, ...globalValues)
}

export * as WorkflowRuntime from "./runtime"
