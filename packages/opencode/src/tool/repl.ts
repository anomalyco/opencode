import z from "zod"
import { spawn, type ChildProcess } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./repl.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Session } from "../session"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"

const MAX_OUTPUT_LENGTH = 50_000
const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes for REPL operations

export const log = Log.create({ service: "repl-tool" })

// Store persistent REPL processes per session
interface ReplState {
  process: ChildProcess
  context: string
  lastActivity: number
  outputBuffer: string
  isReady: boolean
}

const replProcesses = new Map<string, ReplState>()

// Cleanup idle processes after 30 minutes
const IDLE_TIMEOUT = 30 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [sessionId, state] of replProcesses) {
    if (now - state.lastActivity > IDLE_TIMEOUT) {
      log.info("cleaning up idle REPL process", { sessionId })
      state.process.kill()
      replProcesses.delete(sessionId)
    }
  }
}, 60_000)

interface ReplResponse {
  type: "output" | "error" | "final" | "final_var" | "llm_request" | "llm_batch_request"
  content: string
  varName?: string
  prompt?: string
  queryContext?: string
  // For batch requests
  queries?: Array<{ prompt: string; queryContext?: string }>
  batchId?: string
}

// Python REPL script with integrated LLM query support
const PYTHON_REPL_SCRIPT = `
import sys
import json
import re
import traceback
import uuid
from io import StringIO
from contextlib import redirect_stdout, redirect_stderr

# Store context and variables
context = ""
_variables = {}
_batch_counter = 0

def llm_query(prompt, ctx=""):
    """Query a sub-LLM with the given prompt and optional context.

    This function sends a request to the parent TypeScript process
    and blocks until it receives a response.
    """
    # Send request to parent
    request = json.dumps({
        "type": "llm_request",
        "prompt": prompt,
        "queryContext": ctx
    })
    print(f"__REPL_RESPONSE__{request}__END_REPL_RESPONSE__", flush=True)

    # Block waiting for response from parent
    while True:
        line = sys.stdin.readline()
        if not line:
            return "Error: Connection closed"
        line = line.strip()
        if line.startswith("__LLM_RESULT__") and line.endswith("__END_LLM_RESULT__"):
            result = line[14:-17]
            return result

def llm_query_parallel(queries):
    """Execute multiple LLM queries in parallel.

    Args:
        queries: List of dicts with 'prompt' and optional 'context' keys,
                 OR list of strings (treated as prompts with no context)

    Returns:
        List of results in the same order as queries

    Example:
        results = llm_query_parallel([
            {"prompt": "Summarize section 1", "context": chunk1},
            {"prompt": "Summarize section 2", "context": chunk2},
            {"prompt": "Summarize section 3", "context": chunk3},
        ])
    """
    global _batch_counter
    _batch_counter += 1
    batch_id = f"batch_{_batch_counter}"

    # Normalize queries to list of dicts
    normalized = []
    for q in queries:
        if isinstance(q, str):
            normalized.append({"prompt": q, "queryContext": ""})
        else:
            normalized.append({
                "prompt": q.get("prompt", ""),
                "queryContext": q.get("context", q.get("queryContext", ""))
            })

    # Send batch request
    request = json.dumps({
        "type": "llm_batch_request",
        "queries": normalized,
        "batchId": batch_id
    })
    print(f"__REPL_RESPONSE__{request}__END_REPL_RESPONSE__", flush=True)

    # Wait for batch results
    while True:
        line = sys.stdin.readline()
        if not line:
            return ["Error: Connection closed"] * len(queries)
        line = line.strip()
        if line.startswith("__LLM_BATCH_RESULT__") and line.endswith("__END_LLM_BATCH_RESULT__"):
            result_json = line[20:-22]
            try:
                results = json.loads(result_json)
                return results
            except:
                return ["Error: Invalid batch result"] * len(queries)

def llm_map(prompt_template, items, max_parallel=10):
    """Apply an LLM query to each item using parallel execution.

    Args:
        prompt_template: String with {item} placeholder, or callable(item) -> prompt
        items: List of items to process
        max_parallel: Maximum concurrent queries (default 10)

    Returns:
        List of results in same order as items

    Example:
        summaries = llm_map("Summarize this text: {item}", chunks)
        # Or with a function:
        summaries = llm_map(lambda x: f"Analyze: {x[:500]}", chunks)
    """
    results = []
    for i in range(0, len(items), max_parallel):
        batch = items[i:i+max_parallel]
        queries = []
        for item in batch:
            if callable(prompt_template):
                prompt = prompt_template(item)
            else:
                prompt = prompt_template.format(item=item)
            queries.append({"prompt": prompt})
        batch_results = llm_query_parallel(queries)
        results.extend(batch_results)
    return results

# Context analysis helpers
def probe_context():
    """Analyze the context and return useful metadata."""
    info = {
        "type": str(type(context).__name__),
        "length": len(context) if context else 0,
    }

    if isinstance(context, str):
        info["lines"] = context.count('\\n') + 1
        info["words"] = len(context.split())
        # Detect structure
        if context.strip().startswith('{') or context.strip().startswith('['):
            info["format"] = "json"
        elif '\\n---\\n' in context:
            info["format"] = "yaml_multi_doc"
        elif re.search(r'^#{1,6}\\s', context, re.MULTILINE):
            info["format"] = "markdown"
        elif '<html' in context.lower() or '<!doctype' in context.lower():
            info["format"] = "html"
        else:
            info["format"] = "text"

        # Sample
        info["preview"] = context[:1000] if len(context) > 1000 else context
        info["tail"] = context[-500:] if len(context) > 500 else ""

    return info

def smart_chunk(text, target_size=8000, overlap=200, separators=None):
    """Split text into chunks that preserve semantic boundaries.

    Args:
        text: String to chunk
        target_size: Target chunk size in characters
        overlap: Overlap between chunks
        separators: List of separators to try, in order of preference

    Returns:
        List of chunks
    """
    if separators is None:
        separators = [
            '\\n## ',      # Markdown h2
            '\\n# ',       # Markdown h1
            '\\n\\n\\n',   # Triple newline
            '\\n\\n',      # Paragraph
            '\\n',         # Line
            '. ',          # Sentence
        ]

    if len(text) <= target_size:
        return [text]

    chunks = []
    current = ""

    # Try to find best separator
    best_sep = '\\n'
    for sep in separators:
        if sep in text:
            best_sep = sep
            break

    parts = text.split(best_sep)

    for part in parts:
        part_with_sep = part + best_sep
        if len(current) + len(part_with_sep) > target_size and current:
            chunks.append(current.strip())
            # Keep overlap from end of previous chunk
            if overlap > 0:
                current = current[-overlap:] + part_with_sep
            else:
                current = part_with_sep
        else:
            current += part_with_sep

    if current.strip():
        chunks.append(current.strip())

    return chunks

def plan_decomposition(task_description):
    """Ask the LLM to plan how to decompose the context for a given task.

    Returns a strategy dict with recommended approach.
    """
    info = probe_context()

    planning_prompt = f"""Given a context with these properties:
- Type: {info['type']}
- Length: {info['length']} characters
- Lines: {info.get('lines', 'N/A')}
- Format: {info.get('format', 'unknown')}
- Preview: {info.get('preview', '')[:500]}...

Task: {task_description}

Recommend a decomposition strategy. Respond in JSON format:
{{
    "approach": "chunk|filter|hierarchical|map_reduce",
    "chunk_size": <number or null>,
    "filter_pattern": "<regex or null>",
    "num_stages": <1-3>,
    "description": "<brief strategy description>"
}}"""

    result = llm_query(planning_prompt)
    try:
        # Try to extract JSON from response
        match = re.search(r'\\{[^{}]*\\}', result, re.DOTALL)
        if match:
            return json.loads(match.group())
    except:
        pass

    return {"approach": "chunk", "chunk_size": 8000, "description": result}

def _check_final_patterns(output):
    """Check for FINAL() or FINAL_VAR() patterns in output."""
    # Check for FINAL(content) - matches the last occurrence
    lines = output.strip().split('\\n')
    for line in reversed(lines):
        line = line.strip()
        final_match = re.match(r'^FINAL\\((.*)\\)$', line, re.DOTALL)
        if final_match:
            return {"type": "final", "content": final_match.group(1)}

        final_var_match = re.match(r'^FINAL_VAR\\(([^)]+)\\)$', line)
        if final_var_match:
            var_name = final_var_match.group(1).strip()
            if var_name in _variables:
                return {"type": "final_var", "content": str(_variables[var_name]), "varName": var_name}
            return {"type": "error", "content": f"Variable '{var_name}' not found in REPL environment"}

    return None

def execute_code(code):
    """Execute Python code and capture output."""
    global context, _variables

    stdout_capture = StringIO()
    stderr_capture = StringIO()

    # Build execution namespace
    exec_globals = {
        'context': context,
        'llm_query': llm_query,
        '__builtins__': __builtins__,
        're': __import__('re'),
        'json': __import__('json'),
    }
    exec_globals.update(_variables)

    try:
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, exec_globals)

        # Store new variables (excluding special names)
        for key, value in exec_globals.items():
            if not key.startswith('_') and key not in ('context', 'llm_query', '__builtins__', 're', 'json'):
                _variables[key] = value

        # Update context if modified
        if exec_globals.get('context') != context:
            context = exec_globals.get('context', context)
            _variables['context'] = context

        stdout_output = stdout_capture.getvalue()
        stderr_output = stderr_capture.getvalue()

        output = stdout_output
        if stderr_output:
            output += f"\\nSTDERR:\\n{stderr_output}"

        # Check for final answer patterns
        final_result = _check_final_patterns(output)
        if final_result:
            return final_result

        return {"type": "output", "content": output}

    except Exception as e:
        tb = traceback.format_exc()
        return {"type": "error", "content": f"{type(e).__name__}: {str(e)}\\n{tb}"}

# Signal ready
print("__REPL_READY__", flush=True)

# Main command loop
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break

        line = line.strip()
        if not line.startswith("__REPL_CMD__") or not line.endswith("__END_REPL_CMD__"):
            continue

        cmd_json = line[12:-16]
        try:
            cmd = json.loads(cmd_json)

            if cmd["type"] == "set_context":
                context = cmd.get("context", "")
                _variables["context"] = context
                response = {"type": "output", "content": f"Context loaded ({len(context)} characters)"}

            elif cmd["type"] == "execute":
                code = cmd.get("code", "")
                response = execute_code(code)

            elif cmd["type"] == "get_var":
                var_name = cmd.get("varName", "")
                if var_name in _variables:
                    response = {"type": "output", "content": str(_variables[var_name])}
                else:
                    response = {"type": "error", "content": f"Variable '{var_name}' not found"}

            elif cmd["type"] == "ping":
                response = {"type": "output", "content": "pong"}

            else:
                response = {"type": "error", "content": f"Unknown command: {cmd['type']}"}

            print(f"__REPL_RESPONSE__{json.dumps(response)}__END_REPL_RESPONSE__", flush=True)

        except json.JSONDecodeError as e:
            print(f"__REPL_RESPONSE__{{\"type\":\"error\",\"content\":\"Invalid JSON: {e}\"}}__END_REPL_RESPONSE__", flush=True)

    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"__REPL_RESPONSE__{{\"type\":\"error\",\"content\":\"REPL error: {e}\"}}__END_REPL_RESPONSE__", flush=True)
`

async function createReplProcess(sessionId: string): Promise<ReplState> {
  return new Promise((resolve, reject) => {
    log.info("creating REPL process", { sessionId })

    const pythonProcess = spawn("python3", ["-u", "-c", PYTHON_REPL_SCRIPT], {
      cwd: Instance.directory,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    const state: ReplState = {
      process: pythonProcess,
      context: "",
      lastActivity: Date.now(),
      outputBuffer: "",
      isReady: false,
    }

    const readyTimeout = setTimeout(() => {
      if (!state.isReady) {
        pythonProcess.kill()
        reject(new Error("REPL process failed to initialize"))
      }
    }, 10_000)

    pythonProcess.stdout?.on("data", (data: Buffer) => {
      state.outputBuffer += data.toString()

      if (!state.isReady && state.outputBuffer.includes("__REPL_READY__")) {
        state.isReady = true
        state.outputBuffer = ""
        clearTimeout(readyTimeout)
        replProcesses.set(sessionId, state)
        resolve(state)
      }
    })

    pythonProcess.stderr?.on("data", (data: Buffer) => {
      log.warn("REPL stderr", { sessionId, output: data.toString() })
    })

    pythonProcess.on("error", (err) => {
      clearTimeout(readyTimeout)
      replProcesses.delete(sessionId)
      reject(err)
    })

    pythonProcess.on("exit", (code) => {
      log.info("REPL process exited", { sessionId, code })
      replProcesses.delete(sessionId)
    })
  })
}

async function executeInRepl(
  state: ReplState,
  command: { type: string; code?: string; context?: string; varName?: string },
  ctx: Tool.Context,
  timeout: number,
): Promise<ReplResponse> {
  return new Promise(async (resolve, reject) => {
    const cmdJson = JSON.stringify(command)
    const fullCmd = `__REPL_CMD__${cmdJson}__END_REPL_CMD__\n`

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    let resolved = false

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      state.process.stdout?.removeListener("data", onData)
    }

    const onData = async (data: Buffer) => {
      if (resolved) return

      state.outputBuffer += data.toString()

      // Look for response
      const match = state.outputBuffer.match(/__REPL_RESPONSE__(.+?)__END_REPL_RESPONSE__/s)
      if (match) {
        const beforeMatch = state.outputBuffer.indexOf(match[0])
        state.outputBuffer = state.outputBuffer.slice(beforeMatch + match[0].length)

        try {
          const response = JSON.parse(match[1]) as ReplResponse

          // Check if this is an LLM query request
          if (response.type === "llm_request") {
            // Handle the LLM query and send result back to Python
            try {
              const llmResult = await handleLlmQuery(
                ctx,
                response.prompt || "",
                response.queryContext || "",
              )
              // Send result back to Python REPL
              state.process.stdin?.write(`__LLM_RESULT__${llmResult}__END_LLM_RESULT__\n`)
              // Continue listening for the final response
              return
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e)
              state.process.stdin?.write(`__LLM_RESULT__Error: ${errorMsg}__END_LLM_RESULT__\n`)
              return
            }
          }

          // Check if this is a batch LLM query request (parallel execution)
          if (response.type === "llm_batch_request" && response.queries) {
            try {
              const batchResults = await handleLlmBatchQuery(ctx, response.queries)
              const resultsJson = JSON.stringify(batchResults)
              state.process.stdin?.write(
                `__LLM_BATCH_RESULT__${resultsJson}__END_LLM_BATCH_RESULT__\n`,
              )
              return
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e)
              const errorResults = response.queries.map(() => `Error: ${errorMsg}`)
              state.process.stdin?.write(
                `__LLM_BATCH_RESULT__${JSON.stringify(errorResults)}__END_LLM_BATCH_RESULT__\n`,
              )
              return
            }
          }

          // Normal response - we're done
          resolved = true
          cleanup()
          resolve(response)
        } catch (e) {
          resolved = true
          cleanup()
          reject(new Error(`Failed to parse REPL response: ${e}`))
        }
      }
    }

    state.process.stdout?.on("data", onData)

    timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error("REPL command timed out"))
      }
    }, timeout)

    // Send command to Python
    state.process.stdin?.write(fullCmd)
  })
}

async function handleLlmQuery(
  ctx: Tool.Context,
  prompt: string,
  queryContext: string,
): Promise<string> {
  log.info("handling llm_query", {
    sessionId: ctx.sessionID,
    promptLength: prompt.length,
    contextLength: queryContext.length,
  })

  try {
    // Get model from parent session
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    const userMsg = messages.find((m) => m.info.role === "user")
    const model = userMsg?.info.role === "user" ? userMsg.info.model : await Provider.defaultModel()

    // Create sub-session
    const childSession = await Session.create({
      parentID: ctx.sessionID,
      title: "RLM sub-query",
    })

    const agent = (await Agent.get("rlm-sub")) || (await Agent.get("general"))
    if (!agent) {
      throw new Error("No agent available for sub-LLM call")
    }

    const fullPrompt = queryContext ? `${prompt}\n\nContext:\n${queryContext}` : prompt

    const result = await SessionPrompt.prompt({
      messageID: Identifier.ascending("message"),
      sessionID: childSession.id,
      model,
      agent: agent.name,
      parts: [{ type: "text", text: fullPrompt }],
    })

    const textPart = result.parts.find((p) => p.type === "text") as { text: string } | undefined
    return textPart?.text ?? ""
  } catch (e) {
    log.error("llm_query failed", { error: e, sessionId: ctx.sessionID })
    throw e
  }
}

async function handleLlmBatchQuery(
  ctx: Tool.Context,
  queries: Array<{ prompt: string; queryContext?: string }>,
): Promise<string[]> {
  log.info("handling llm_batch_query", {
    sessionId: ctx.sessionID,
    queryCount: queries.length,
  })

  try {
    // Get model from parent session
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    const userMsg = messages.find((m) => m.info.role === "user")
    const model = userMsg?.info.role === "user" ? userMsg.info.model : await Provider.defaultModel()

    const agent = (await Agent.get("rlm-sub")) || (await Agent.get("general"))
    if (!agent) {
      throw new Error("No agent available for sub-LLM batch call")
    }

    // Execute all queries in parallel
    const results = await Promise.all(
      queries.map(async (query, index) => {
        try {
          const childSession = await Session.create({
            parentID: ctx.sessionID,
            title: `RLM batch sub-query ${index + 1}/${queries.length}`,
          })

          const fullPrompt = query.queryContext
            ? `${query.prompt}\n\nContext:\n${query.queryContext}`
            : query.prompt

          const result = await SessionPrompt.prompt({
            messageID: Identifier.ascending("message"),
            sessionID: childSession.id,
            model,
            agent: agent.name,
            parts: [{ type: "text", text: fullPrompt }],
          })

          const textPart = result.parts.find((p) => p.type === "text") as
            | { text: string }
            | undefined
          return textPart?.text ?? ""
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          log.error("batch query item failed", { error: e, index, sessionId: ctx.sessionID })
          return `Error: ${errorMsg}`
        }
      }),
    )

    log.info("batch query completed", {
      sessionId: ctx.sessionID,
      queryCount: queries.length,
      successCount: results.filter((r) => !r.startsWith("Error:")).length,
    })

    return results
  } catch (e) {
    log.error("llm_batch_query failed", { error: e, sessionId: ctx.sessionID })
    throw e
  }
}

async function getOrCreateRepl(sessionId: string): Promise<ReplState> {
  let state = replProcesses.get(sessionId)

  if (!state || state.process.killed || !state.process.stdin?.writable) {
    state = await createReplProcess(sessionId)
  }

  state.lastActivity = Date.now()
  return state
}

export const ReplTool = Tool.define("repl", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      code: z.string().describe("Python code to execute in the REPL environment"),
      context: z
        .string()
        .optional()
        .describe(
          "Optional context to load into the REPL environment. This will be available as the 'context' variable. Only needs to be set once per session - it persists across calls.",
        ),
      timeout: z
        .number()
        .optional()
        .describe("Optional timeout in milliseconds. Defaults to 5 minutes (300000ms)."),
    }),
    async execute(params, ctx) {
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      try {
        // Get or create REPL
        const replState = await getOrCreateRepl(ctx.sessionID)

        // Set context if provided and different from current
        if (params.context && params.context !== replState.context) {
          replState.context = params.context
          await executeInRepl(
            replState,
            { type: "set_context", context: params.context },
            ctx,
            30_000, // 30s timeout for setting context
          )
        }

        // Execute code
        const response = await executeInRepl(
          replState,
          { type: "execute", code: params.code },
          ctx,
          timeout,
        )

        let output = response.content
        const metadata: Record<string, any> = {
          contextLength: replState.context.length,
        }

        if (response.type === "final" || response.type === "final_var") {
          metadata.finalAnswer = response.content
          metadata.finalType = response.type
          if (response.varName) {
            metadata.finalVarName = response.varName
          }
          output = `FINAL ANSWER:\n${response.content}`
        } else if (response.type === "error") {
          output = `Error:\n${response.content}`
        }

        // Truncate if needed
        if (output.length > MAX_OUTPUT_LENGTH) {
          output =
            output.slice(0, MAX_OUTPUT_LENGTH) +
            "\n\n[Output truncated - use llm_query() for large output analysis]"
        }

        return {
          title:
            response.type === "final" || response.type === "final_var"
              ? "REPL: Final answer"
              : response.type === "error"
                ? "REPL: Error"
                : "REPL: Executed",
          metadata: { ...metadata, output },
          output,
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        log.error("REPL execution failed", { error: e, sessionId: ctx.sessionID })

        return {
          title: "REPL: Error",
          metadata: { error: errorMsg },
          output: `REPL Error: ${errorMsg}`,
        }
      }
    },
  }
})

// Cleanup when session ends
export function cleanupReplSession(sessionId: string) {
  const state = replProcesses.get(sessionId)
  if (state) {
    state.process.kill()
    replProcesses.delete(sessionId)
    log.info("cleaned up REPL session", { sessionId })
  }
}
