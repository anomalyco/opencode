/**
 * GitHub Channel
 *
 * Listens for GitHub webhook events and turns them into OpenAgent tasks.
 * Handles:
 *   - issue.opened / issue.labeled   → triage or fix
 *   - pull_request.opened            → review
 *   - pull_request_review.submitted  → respond to review comments
 *   - push                           → run CI-triggered tasks
 *   - workflow_dispatch              → manual trigger from GitHub Actions
 *
 * The channel posts results back as GitHub comments/PR reviews.
 */

import { Hono } from "hono"
import { z } from "zod"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubChannelOptions {
  /** GitHub webhook secret for payload validation */
  secret?: string
  /**
   * Map of event patterns to task templates.
   * e.g. "issues.opened" → "Triage this GitHub issue and add labels"
   */
  eventHandlers?: Record<string, GitHubEventHandler>
}

export interface GitHubEventHandler {
  title: (payload: GitHubPayload) => string
  description: (payload: GitHubPayload) => string
  priority?: "low" | "normal" | "high" | "critical"
  /** If true, post result as a GitHub comment (requires GITHUB_TOKEN) */
  postComment?: boolean
}

export interface GitHubPayload {
  action?: string
  issue?: { number: number; title: string; body: string; labels: string[]; url: string }
  pull_request?: { number: number; title: string; body: string; url: string; head: { ref: string } }
  repository?: { full_name: string; clone_url: string; html_url: string }
  sender?: { login: string }
  [key: string]: unknown
}

type SubmitTask = (input: {
  title: string
  description: string
  priority?: string
  source: { channel: "github"; metadata: Record<string, unknown> }
}) => Promise<{ taskId: string; result: Promise<string> }>

// ─── Default Event Handlers ───────────────────────────────────────────────────

const defaultHandlers: Record<string, GitHubEventHandler> = {
  "issues.opened": {
    title: (p) => `Triage issue: ${p.issue?.title ?? "Unknown"}`,
    description: (p) =>
      `A new GitHub issue was opened on ${p.repository?.full_name}.\n\n` +
      `Issue #${p.issue?.number}: ${p.issue?.title}\n\n` +
      `Body:\n${p.issue?.body ?? "(no body)"}\n\n` +
      `Analyze this issue and:\n` +
      `1. Explore the codebase to understand the context\n` +
      `2. Determine the root cause if it's a bug\n` +
      `3. Provide a detailed analysis and suggested fix or next steps\n` +
      `4. Suggest appropriate labels based on the issue content`,
    priority: "normal",
    postComment: true,
  },

  "pull_request.opened": {
    title: (p) => `Review PR: ${p.pull_request?.title ?? "Unknown"}`,
    description: (p) =>
      `A pull request was opened on ${p.repository?.full_name}.\n\n` +
      `PR #${p.pull_request?.number}: ${p.pull_request?.title}\n` +
      `Branch: ${p.pull_request?.head?.ref}\n\n` +
      `Body:\n${p.pull_request?.body ?? "(no description)"}\n\n` +
      `Please review this PR:\n` +
      `1. Explore the changed files and understand what was modified\n` +
      `2. Check for bugs, edge cases, and security issues\n` +
      `3. Verify the changes make sense and follow project conventions\n` +
      `4. Provide a detailed code review with specific line-level feedback`,
    priority: "normal",
    postComment: true,
  },

  "workflow_dispatch": {
    title: (p) => `Workflow task: ${(p.inputs as any)?.task ?? "Manual trigger"}`,
    description: (p) =>
      `A GitHub Actions workflow was manually triggered.\n\n` +
      `Repository: ${p.repository?.full_name}\n` +
      `Task: ${(p.inputs as any)?.task ?? "No task specified"}\n\n` +
      `Execute the requested task using the available coding tools.`,
    priority: "high",
    postComment: false,
  },
}

// ─── GitHub Channel ───────────────────────────────────────────────────────────

/**
 * Creates a Hono sub-app that handles GitHub webhook events.
 * Mount this under /github on the main HTTP server.
 */
export function createGitHubChannel(submitTask: SubmitTask, options: GitHubChannelOptions = {}): Hono {
  const app = new Hono()
  const handlers = { ...defaultHandlers, ...options.eventHandlers }

  app.post("/webhook", async (c) => {
    const event = c.req.header("x-github-event")
    if (!event) return c.json({ error: "Missing x-github-event header" }, 400)

    // Verify signature if secret is configured
    if (options.secret) {
      const sig = c.req.header("x-hub-signature-256")
      if (!sig) return c.json({ error: "Missing signature" }, 401)

      const body = await c.req.text()
      const valid = await verifyGitHubSignature(body, sig, options.secret)
      if (!valid) return c.json({ error: "Invalid signature" }, 401)
    }

    let payload: GitHubPayload
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400)
    }

    const action = payload.action
    const eventKey = action ? `${event}.${action}` : event
    const handler = handlers[eventKey] ?? handlers[event]

    if (!handler) {
      return c.json({ message: `No handler for ${eventKey}` }, 200)
    }

    const title = handler.title(payload)
    const description = handler.description(payload)

    const { taskId, result } = await submitTask({
      title,
      description,
      priority: handler.priority,
      source: {
        channel: "github",
        metadata: {
          event,
          action,
          repo: payload.repository?.full_name,
          sender: payload.sender?.login,
          issueNumber: payload.issue?.number,
          prNumber: payload.pull_request?.number,
        },
      },
    })

    // Post result as GitHub comment if configured and GITHUB_TOKEN is available
    if (handler.postComment && process.env.GITHUB_TOKEN) {
      result
        .then(async (text) => {
          const repo = payload.repository?.full_name
          const number = payload.issue?.number ?? payload.pull_request?.number
          if (repo && number) {
            await postGitHubComment(repo, number, text)
          }
        })
        .catch(console.error)
    } else {
      result.catch(() => {})
    }

    return c.json({ taskId, status: "accepted" }, 202)
  })

  return app
}

// ─── GitHub API Helpers ───────────────────────────────────────────────────────

async function postGitHubComment(repo: string, number: number, body: string) {
  const token = process.env.GITHUB_TOKEN
  if (!token) return

  const url = `https://api.github.com/repos/${repo}/issues/${number}/comments`
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "openagent/1.0",
    },
    body: JSON.stringify({ body: `**OpenAgent Result**\n\n${body}` }),
  })
}

async function verifyGitHubSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body))
  const hex = "sha256=" + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("")
  return hex === signature
}
