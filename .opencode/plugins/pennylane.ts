import { type Plugin, tool } from "@opencode-ai/plugin"

const bin = () => process.env.PENNYLANE_CLI_BIN || "pennylane"

const list = {
  limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum number of items to return"),
  cursor: tool.schema.string().optional().describe("Pennylane cursor token"),
  sort: tool.schema.string().optional().describe("Pennylane sort field, prefix with - for descending"),
  filter_json: tool.schema.string().optional().describe("Pennylane filter array encoded as a JSON string"),
}

function text(input: string) {
  return input.trim()
}

function message(input: string) {
  const body = text(input)
  if (!body) return

  try {
    const data = JSON.parse(body)
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
      return data.message
    }
  } catch {}

  return body
}

function json(input: string, args: string[]) {
  try {
    return JSON.parse(input)
  } catch {
    throw new Error(`pennylane ${args.join(" ")} returned invalid JSON`)
  }
}

function format(input: unknown) {
  return JSON.stringify(input, null, 2)
}

async function run(ctx: { directory: string; worktree: string }, args: string[]) {
  const proc = Bun.spawn([bin(), ...args], {
    cwd: ctx.worktree || ctx.directory,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const out = new Response(proc.stdout).text()
  const err = new Response(proc.stderr).text()
  const code = await proc.exited
  const body = await out
  const fail = message(await err)

  if (code !== 0) {
    throw new Error(fail || `pennylane ${args.join(" ")} failed with exit code ${code}`)
  }

  if (fail) {
    throw new Error(fail)
  }

  const value = text(body)
  if (!value) {
    throw new Error(`pennylane ${args.join(" ")} returned no output`)
  }

  return format(json(value, args))
}

function push(args: string[], input: { limit?: number; cursor?: string; sort?: string; filter_json?: string }) {
  if (input.limit !== undefined) args.push("--limit", String(input.limit))
  if (input.cursor) args.push("--cursor", input.cursor)
  if (input.sort) args.push("--sort", input.sort)
  if (input.filter_json) args.push("--filter-json", input.filter_json)
  return args
}

const PennylanePlugin: Plugin = async () => ({
  tool: {
    pennylane_health: tool({
      description: "Check Pennylane authentication through the local CLI",
      args: {},
      async execute(args, ctx) {
        return run(ctx, ["health"])
      },
    }),
    pennylane_me: tool({
      description: "Fetch the authenticated Pennylane user through the local CLI",
      args: {},
      async execute(args, ctx) {
        return run(ctx, ["me"])
      },
    }),
    pennylane_ledger_accounts_list: tool({
      description: "List Pennylane ledger accounts through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["ledger-accounts", "list"], args))
      },
    }),
    pennylane_ledger_accounts_get: tool({
      description: "Get a Pennylane ledger account through the local CLI",
      args: {
        id: tool.schema.number().int().positive().describe("Pennylane ledger account id"),
      },
      async execute(args, ctx) {
        return run(ctx, ["ledger-accounts", "get", String(args.id)])
      },
    }),
    pennylane_ledger_entries_list: tool({
      description: "List Pennylane ledger entries through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["ledger-entries", "list"], args))
      },
    }),
    pennylane_ledger_entries_get: tool({
      description: "Get a Pennylane ledger entry through the local CLI",
      args: {
        id: tool.schema.number().int().positive().describe("Pennylane ledger entry id"),
      },
      async execute(args, ctx) {
        return run(ctx, ["ledger-entries", "get", String(args.id)])
      },
    }),
    pennylane_journals_list: tool({
      description: "List Pennylane journals through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["journals", "list"], args))
      },
    }),
    pennylane_journals_get: tool({
      description: "Get a Pennylane journal through the local CLI",
      args: {
        id: tool.schema.number().int().positive().describe("Pennylane journal id"),
      },
      async execute(args, ctx) {
        return run(ctx, ["journals", "get", String(args.id)])
      },
    }),
    pennylane_transactions_list: tool({
      description: "List Pennylane transactions through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["transactions", "list"], args))
      },
    }),
    pennylane_transactions_get: tool({
      description: "Get a Pennylane transaction through the local CLI",
      args: {
        id: tool.schema.number().int().positive().describe("Pennylane transaction id"),
      },
      async execute(args, ctx) {
        return run(ctx, ["transactions", "get", String(args.id)])
      },
    }),
    pennylane_bank_accounts_list: tool({
      description: "List Pennylane bank accounts through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["bank-accounts", "list"], args))
      },
    }),
    pennylane_bank_accounts_get: tool({
      description: "Get a Pennylane bank account through the local CLI",
      args: {
        id: tool.schema.number().int().positive().describe("Pennylane bank account id"),
      },
      async execute(args, ctx) {
        return run(ctx, ["bank-accounts", "get", String(args.id)])
      },
    }),
    pennylane_fiscal_years_list: tool({
      description: "List Pennylane fiscal years through the local CLI",
      args: list,
      async execute(args, ctx) {
        return run(ctx, push(["fiscal-years", "list"], args))
      },
    }),
  },
})

export default PennylanePlugin
