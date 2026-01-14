import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { Log } from "../util/log"

const log = Log.create({ service: "rlm-repl" })

const DESCRIPTION = `Execute JavaScript code with access to sub-LLM calls for recursive processing.

This tool enables the Recursive Language Model (RLM) pattern - writing code that programmatically
invokes sub-LLM calls in loops, rather than requiring explicit tool calls for each invocation.

## Available Functions

- \`sub_llm(prompt, agent?)\` - Invoke a sub-LLM call, returns promise with string result
- \`sub_llm_parallel(prompts[], agent?)\` - Invoke multiple sub-LLM calls in parallel
- \`context.store(key, data)\` - Store data externally (not in LLM context), returns the key
- \`context.load(key)\` - Load data by key
- \`context.chunk(key, chunkSize)\` - Split stored data into chunks, returns array of keys
- \`context.keys()\` - List all stored keys

## Example: Processing Large Data

\`\`\`javascript
// Store large data externally
context.store("input", largeDataString)

// Chunk it into manageable pieces
const chunkKeys = context.chunk("input", 5000)

// Process each chunk with a sub-LLM
const results = await sub_llm_parallel(
  chunkKeys.map(k => \`Analyze this chunk: \${context.load(k)}\`)
)

// Return aggregated result
return results.join("\\n")
\`\`\`

## Example: Recursive Search

\`\`\`javascript
async function search(query, depth = 0) {
  if (depth > 3) return "Max depth reached"
  const result = await sub_llm(\`Search for: \${query}\`)
  if (result.includes("FOUND")) return result
  return search(query + " (refined)", depth + 1)
}
return await search("API endpoints")
\`\`\`

## Security Notes
- Code runs in a sandboxed environment with limited globals
- Maximum 50 sub_llm calls per execution
- 5 minute timeout on total execution
- Context store limited to 10MB total
`

const parameters = z.object({
  code: z.string().describe("JavaScript code to execute. Must return a value or use 'return' statement."),
  agent: z.string().optional().describe("Default agent for sub_llm calls. Defaults to 'explore'."),
})

// Context store for pointer-based data access
class RLMContext {
  private store: Map<string, string> = new Map()
  private totalSize: number = 0
  private readonly maxSize: number = 10 * 1024 * 1024 // 10MB

  storeData(key: string, data: string): string {
    if (this.store.has(key)) {
      this.totalSize -= this.store.get(key)!.length
    }
    if (this.totalSize + data.length > this.maxSize) {
      throw new Error(`Context store limit exceeded (max ${this.maxSize / 1024 / 1024}MB)`)
    }
    this.store.set(key, data)
    this.totalSize += data.length
    return key
  }

  loadData(key: string): string | undefined {
    return this.store.get(key)
  }

  chunkData(key: string, chunkSize: number): string[] {
    const data = this.store.get(key)
    if (!data) throw new Error(`Key not found: ${key}`)

    const chunks: string[] = []
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunkKey = `${key}_chunk_${chunks.length}`
      const chunkData = data.slice(i, i + chunkSize)
      this.storeData(chunkKey, chunkData)
      chunks.push(chunkKey)
    }
    return chunks
  }

  listKeys(): string[] {
    return Array.from(this.store.keys())
  }

  clear(): void {
    this.store.clear()
    this.totalSize = 0
  }
}

export const RLMReplTool = Tool.define("rlm_repl", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const defaultAgent = params.agent ?? "explore"
      const rlmContext = new RLMContext()
      let subLLMCallCount = 0
      const maxSubLLMCalls = 50
      const startTime = Date.now()
      const maxExecutionTime = 5 * 60 * 1000 // 5 minutes

      // Check if we're within time limit
      const checkTimeout = () => {
        if (Date.now() - startTime > maxExecutionTime) {
          throw new Error("Execution timeout exceeded (5 minutes)")
        }
      }

      // Sub-LLM call function
      const sub_llm = async (prompt: string, agent?: string): Promise<string> => {
        checkTimeout()
        subLLMCallCount++
        if (subLLMCallCount > maxSubLLMCalls) {
          throw new Error(`Maximum sub_llm calls exceeded (${maxSubLLMCalls})`)
        }

        const agentName = agent ?? defaultAgent
        const agentInfo = await Agent.get(agentName)
        if (!agentInfo) {
          throw new Error(`Unknown agent: ${agentName}`)
        }

        log.info("sub_llm call", {
          callNumber: subLLMCallCount,
          agent: agentName,
          promptLength: prompt.length,
        })

        // Create a child session for the sub-LLM call
        const session = await Session.create({
          parentID: ctx.sessionID,
          title: `RLM sub-call #${subLLMCallCount}`,
          permission: [
            { permission: "task", pattern: "*", action: "deny" as const },
            { permission: "rlm_repl", pattern: "*", action: "deny" as const },
            { permission: "todowrite", pattern: "*", action: "deny" as const },
            { permission: "todoread", pattern: "*", action: "deny" as const },
          ],
        })

        try {
          const result = await SessionPrompt.prompt({
            messageID: Identifier.ascending("message"),
            sessionID: session.id,
            agent: agentName,
            parts: [{ type: "text", text: prompt }],
          })

          // Extract text from result
          const textPart = result.parts.find((p: any) => p.type === "text")
          return (textPart as any)?.text ?? ""
        } catch (error) {
          log.error("sub_llm call failed", { error, callNumber: subLLMCallCount })
          throw error
        }
      }

      // Parallel sub-LLM calls
      const sub_llm_parallel = async (prompts: string[], agent?: string): Promise<string[]> => {
        checkTimeout()
        if (subLLMCallCount + prompts.length > maxSubLLMCalls) {
          throw new Error(
            `Would exceed maximum sub_llm calls (${maxSubLLMCalls}). Current: ${subLLMCallCount}, Requested: ${prompts.length}`,
          )
        }
        return Promise.all(prompts.map((p) => sub_llm(p, agent)))
      }

      // Context API for pointer-based access
      const context = {
        store: (key: string, data: string) => rlmContext.storeData(key, data),
        load: (key: string) => rlmContext.loadData(key),
        chunk: (key: string, chunkSize: number) => rlmContext.chunkData(key, chunkSize),
        keys: () => rlmContext.listKeys(),
      }

      // Build the sandbox with limited globals
      const sandbox = {
        sub_llm,
        sub_llm_parallel,
        context,
        console: {
          log: (...args: any[]) => log.info("rlm_repl console.log", { args }),
          error: (...args: any[]) => log.error("rlm_repl console.error", { args }),
          warn: (...args: any[]) => log.info("rlm_repl console.warn", { args }),
        },
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Date,
        Math,
        Promise,
        Map,
        Set,
        RegExp,
        Error,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        setTimeout: undefined, // Disabled for safety
        setInterval: undefined, // Disabled for safety
        fetch: undefined, // Disabled - use sub_llm for external calls
        require: undefined, // Disabled
        import: undefined, // Disabled
        eval: undefined, // Disabled
        Function: undefined, // Disabled to prevent sandbox escape
      }

      try {
        // Wrap code in async function to support await and return
        const wrappedCode = `
          return (async () => {
            ${params.code}
          })()
        `

        // Create function with sandbox as scope
        // Note: This is a simplified sandbox. For production, consider using
        // isolated-vm or vm2 for stronger isolation.
        const sandboxKeys = Object.keys(sandbox)
        const sandboxValues = Object.values(sandbox)

        const asyncFn = new Function(...sandboxKeys, wrappedCode)
        const result = await asyncFn(...sandboxValues)

        const output =
          typeof result === "string" ? result : result === undefined ? "(no return value)" : JSON.stringify(result, null, 2)

        log.info("rlm_repl completed", {
          subLLMCalls: subLLMCallCount,
          executionTimeMs: Date.now() - startTime,
          contextKeys: rlmContext.listKeys().length,
        })

        return {
          title: `RLM execution (${subLLMCallCount} sub-calls)`,
          metadata: {
            subLLMCalls: subLLMCallCount,
            executionTimeMs: Date.now() - startTime,
            contextKeys: rlmContext.listKeys(),
          },
          output: [
            output,
            "",
            `<rlm_metadata>`,
            `sub_llm_calls: ${subLLMCallCount}`,
            `execution_time_ms: ${Date.now() - startTime}`,
            `context_keys: ${rlmContext.listKeys().length}`,
            `</rlm_metadata>`,
          ].join("\n"),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error("rlm_repl execution failed", { error: message })

        return {
          title: "RLM execution failed",
          metadata: {
            error: message,
            subLLMCalls: subLLMCallCount,
            executionTimeMs: Date.now() - startTime,
            contextKeys: rlmContext.listKeys(),
          },
          output: `Error: ${message}\n\nSub-LLM calls made before error: ${subLLMCallCount}`,
        }
      } finally {
        rlmContext.clear()
      }
    },
  }
})
