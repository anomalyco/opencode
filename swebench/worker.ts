/**
 * SWE-bench Worker - Process single instance
 */

import { spawn, type Subprocess } from "bun"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import os from "os"
import type { SWEInstance, RunConfig, InstanceResult } from "./types"
import { buildPrompt } from "./prompt"

const MAX_RETRIES = 3

interface Context {
  dir: string
  proc?: Subprocess
  url?: string
  port: number
}

/** Clone repository to temp directory */
async function cloneRepo(instance: SWEInstance): Promise<string> {
  const base = path.join(os.tmpdir(), "swebench")
  await fs.mkdir(base, { recursive: true })

  const dir = path.join(base, `${instance.instance_id.replace(/[/\\:]/g, "_")}-${Date.now()}`)
  const url = `https://github.com/${instance.repo}.git`

  // Clone repo (no shallow clone as we need to checkout specific commit)
  const clone = await $`git clone --filter=blob:none ${url} ${dir}`.quiet().nothrow()
  if (clone.exitCode !== 0) {
    // Fallback to regular clone if filter clone fails
    await $`git clone ${url} ${dir}`.quiet().nothrow()
  }

  // Checkout to base_commit
  const checkout = await $`git -C ${dir} checkout ${instance.base_commit}`.quiet().nothrow()
  if (checkout.exitCode !== 0) throw new Error(`Failed to checkout ${instance.base_commit}`)

  return dir
}

/** Start opencode server */
async function startServer(dir: string, port: number): Promise<{ proc: Subprocess; url: string }> {
  const proc = spawn({
    cmd: ["opencode", "serve", `--hostname=127.0.0.1`, `--port=${port}`],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENCODE_AUTO_APPROVE: "1",
    },
  })

  // Wait for server to start
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server start timeout")), 30000)
    let output = ""
    const reader = proc.stdout.getReader()

    const read = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        output += new TextDecoder().decode(value)
        if (output.includes("opencode server listening")) {
          const match = output.match(/on\s+(https?:\/\/[^\s]+)/)
          if (match) {
            clearTimeout(timer)
            resolve(match[1])
            return
          }
        }
      }
    }
    read().catch(reject)
  })

  return { proc, url }
}

/** Wait for session completion */
async function waitForCompletion(serverUrl: string, sessionId: string, timeout: number): Promise<void> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${serverUrl}/event`, {
      signal: controller.signal,
    })

    if (!response.body) throw new Error("No response body")

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Use stream: true to handle multi-byte character boundaries
      buffer += decoder.decode(value, { stream: true })

      // SSE messages are separated by double newlines
      const messages = buffer.split("\n\n")
      buffer = messages.pop() || "" // Keep incomplete message

      for (const message of messages) {
        for (const line of message.split("\n")) {
          if (!line.startsWith("data:")) continue
          try {
            const event = JSON.parse(line.slice(5).trim())
            if (event.type === "session.idle" && event.properties?.sessionID === sessionId) {
              return
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Extract git diff as patch (SWE-bench harness compatible format) */
async function extractPatch(dir: string): Promise<string> {
  await $`git -C ${dir} add -A`.quiet().nothrow()
  const diff = await $`git -C ${dir} diff --cached`.quiet().text()
  await $`git -C ${dir} reset`.quiet().nothrow()
  return diff.trim()
}

/** Cleanup temp directory */
async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}

/** Execute single attempt */
async function attempt(
  instance: SWEInstance,
  config: RunConfig,
  port: number,
): Promise<{ result?: InstanceResult; error?: string; ctx?: Context }> {
  const dir = await cloneRepo(instance)
  const ctx: Context = { dir, port }

  const { proc, url } = await startServer(dir, port)
  ctx.proc = proc
  ctx.url = url

  // Create session
  const res = await fetch(`${url}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `SWE-bench: ${instance.instance_id}`,
      permission: [
        { permission: "bash", action: "allow", pattern: "*" },
        { permission: "write", action: "allow", pattern: "*" },
        { permission: "edit", action: "allow", pattern: "*" },
        { permission: "read", action: "allow", pattern: "*" },
        { permission: "glob", action: "allow", pattern: "*" },
        { permission: "grep", action: "allow", pattern: "*" },
        { permission: "list", action: "allow", pattern: "*" },
        { permission: "question", action: "deny", pattern: "*" },
      ],
    }),
  })

  if (!res.ok) throw new Error(`Failed to create session: ${res.statusText}`)

  const session = await res.json()
  const prompt = buildPrompt(instance)
  const model = config.model.includes("/") ? config.model.split("/") : ["anthropic", config.model]

  const send = await fetch(`${url}/session/${session.id}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: config.agent || "build",
      model: { providerID: model[0], modelID: model[1] },
      parts: [{ type: "text", text: prompt }],
    }),
  })

  if (!send.ok) throw new Error(`Failed to send prompt: ${send.statusText}`)

  await waitForCompletion(url, session.id, config.timeout)

  const patch = await extractPatch(dir)
  ctx.proc?.kill()
  await cleanup(dir)

  return { result: patch ? { patch } : undefined, ctx }
}

/** Process single instance */
export async function processInstance(
  instance: SWEInstance,
  config: RunConfig,
  port: number,
): Promise<InstanceResult> {
  const start = Date.now()

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const { result, error, ctx } = await attempt(instance, config, port).catch(async (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: msg } as { error: string; ctx?: Context }
    })

    if (result?.patch) {
      return {
        instance_id: instance.instance_id,
        status: "success",
        patch: result.patch,
        duration: Date.now() - start,
        retries: retry,
      }
    }

    if (result && !result.patch) {
      return {
        instance_id: instance.instance_id,
        status: "error",
        error: "No changes made - empty patch",
        duration: Date.now() - start,
        retries: retry,
      }
    }

    // Cleanup
    if (ctx?.proc) ctx.proc.kill()
    if (ctx?.dir) await cleanup(ctx.dir)

    // Don't retry on timeout
    if (error?.includes("timeout") || error?.includes("abort")) {
      return {
        instance_id: instance.instance_id,
        status: "timeout",
        error,
        duration: Date.now() - start,
        retries: retry,
      }
    }
  }

  return {
    instance_id: instance.instance_id,
    status: "error",
    error: "Max retries exceeded",
    duration: Date.now() - start,
    retries: MAX_RETRIES,
  }
}
