import { spawn } from "child_process"
import { mkdir, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import type { TaskInfo, TaskResult } from "@opencode-ai/core/teamjules"
import { createGitClient } from "./git"
import { createGitHubClient } from "./github"

export interface RunnerConfig {
  workDir?: string
  githubToken?: string
  model?: { providerID: string; modelID: string }
  agent?: {
    prompt?: string
  }
}

export interface Runner {
  run(task: TaskInfo, config: RunnerConfig): Promise<TaskResult>
}

const TEAMJULES_WORKER_PROMPT = `You are TeamJules, an autonomous coding agent. Your task is to implement the requested changes independently.

Instructions:
1. Read and understand the task requirements
2. Explore the codebase to understand context
3. Implement the changes using available tools
4. Test your changes when possible
5. Commit and push your work
6. Create a pull request with a clear description

You have full access to file operations, git, and other development tools. Work autonomously and report progress as you complete each step.`

export function createRunner(): Runner {
  const git = createGitClient()

  return {
    async run(task, config) {
      const workDir = join(
        config.workDir ?? tmpdir(),
        `teamjules-${task.id}`
      )

      // Create working directory
      await mkdir(workDir, { recursive: true })

      try {
        // Clone the repository
        await git.clone(task.repo, workDir)

        // Create a branch for this task
        const branchName = `teamjules/${task.id}`
        await git.createBranch(workDir, branchName, task.branch)

        // Start an isolated opencode server in the working directory
        const serverPort = 4096 + Math.floor(Math.random() * 1000)
        const server = await startOpencodeServer(workDir, serverPort)

        try {
          // Create a session and send the prompt
          const result = await executeTask(task, serverPort, config)

          // Check for changes
          const hasChanges = await git.hasChanges(workDir)
          if (!hasChanges) {
            return { error: "No changes made by the LLM" }
          }

          // Commit changes
          await git.commitAll(workDir, `TeamJules: ${task.prompt.slice(0, 72)}`)

          // Push branch
          await git.push(workDir, branchName)

          // Create PR if GitHub token is available
          if (config.githubToken) {
            const github = createGitHubClient(config.githubToken)
            const pr = await github.createPR(task.repo, {
              title: `TeamJules: ${task.prompt.slice(0, 72)}`,
              body: `Automated PR created by TeamJules\n\nTask: ${task.id}\nPrompt: ${task.prompt}`,
              head: branchName,
              base: task.branch,
            })
            return { pr_url: pr.url, commit_sha: pr.head_sha }
          }

          return { commit_sha: await git.getRev(workDir) }
        } finally {
          // Stop the server
          await stopOpencodeServer(server)
        }
      } finally {
        // Clean up working directory
        await rm(workDir, { recursive: true, force: true })
      }
    },
  }
}

interface OpencodeServer {
  process: ReturnType<typeof spawn>
  port: number
}

async function startOpencodeServer(cwd: string, port: number): Promise<OpencodeServer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", ["serve", `--port=${port}`], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    })

    let started = false
    proc.stdout?.on("data", (data) => {
      if (!started && data.toString().includes("listening")) {
        started = true
        resolve({ process: proc, port })
      }
    })

    proc.stderr?.on("data", (data) => {
      if (!started && data.toString().includes("listening")) {
        started = true
        resolve({ process: proc, port })
      }
    })

    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (!started) {
        reject(new Error(`Server exited with code ${code}`))
      }
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!started) {
        proc.kill()
        reject(new Error("Server start timeout"))
      }
    }, 30_000)
  })
}

async function stopOpencodeServer(server: OpencodeServer): Promise<void> {
  return new Promise((resolve) => {
    server.process.on("exit", () => resolve())
    server.process.kill("SIGTERM")
    setTimeout(() => {
      server.process.kill("SIGKILL")
      resolve()
    }, 5_000)
  })
}

async function executeTask(
  task: TaskInfo,
  port: number,
  config: RunnerConfig
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`

  // Wait for server to be ready
  let retries = 0
  while (retries < 30) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 1_000))
    retries++
  }

  // Create session with teamjules-worker agent
  const sessionResponse = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `TeamJules: ${task.prompt.slice(0, 50)}`,
      model: config.model,
      agent: "teamjules-worker",
    }),
  })
  if (!sessionResponse.ok) {
    const errText = await sessionResponse.text()
    throw new Error(`Failed to create session: ${sessionResponse.status} ${errText}`)
  }
  const sessionJson = (await sessionResponse.json()) as { data?: { id: string }; id?: string }
  const sessionId = sessionJson.data?.id ?? sessionJson.id
  if (!sessionId) {
    throw new Error(`Session ID not found in create response: ${JSON.stringify(sessionJson)}`)
  }

  // Build the full prompt with system context
  const systemPrompt = config.agent?.prompt || TEAMJULES_WORKER_PROMPT
  const fullPrompt = `${systemPrompt}\n\n## Task\n${task.prompt}`

  // Send prompt using V2 schema
  const promptResponse = await fetch(`${baseUrl}/api/session/${sessionId}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: { text: fullPrompt },
    }),
  })
  if (!promptResponse.ok) {
    const errText = await promptResponse.text()
    throw new Error(`Failed to prompt session: ${promptResponse.status} ${errText}`)
  }

  // Wait for completion (poll active session map via GET /api/session/active)
  let running = true
  while (running) {
    await new Promise((r) => setTimeout(r, 2_000))
    try {
      const activeResponse = await fetch(`${baseUrl}/api/session/active`)
      if (activeResponse.ok) {
        const activeData = (await activeResponse.json()) as { data?: Record<string, unknown> }
        running = Boolean(activeData.data && activeData.data[sessionId])
      } else {
        break
      }
    } catch {
      break
    }
  }
}

