import { onCleanup } from "solid-js"
import type { Repo, RepoCloneCredentials, RepoCloneProgress } from "@opencode-ai/sdk/v2/client"

export type CloneProgressServer = {
  url: string | undefined
}

export type CloneProgressPlatform = {
  fetch?: typeof fetch
}

export type CloneAuthType = "ssh" | "github_pat" | "https_basic"

export interface UseCloneProgressOptions {
  onProgress: (progress: RepoCloneProgress) => void
  onComplete: (repo: Repo, message: string) => void
  onError: (message: string, helpSteps?: string[], authType?: CloneAuthType, canRetry?: boolean) => void
}

export interface UseCloneProgressReturn {
  startClone: (url: string, branch?: string) => void
  startCloneWithCredentials: (url: string, credentials: RepoCloneCredentials, branch?: string) => Promise<void>
  cancel: () => void
}

export function useCloneProgress(
  options: UseCloneProgressOptions,
  deps: { server: CloneProgressServer; platform: CloneProgressPlatform },
): UseCloneProgressReturn {
  const server = deps.server
  const platform = deps.platform
  let maybeEventSource: EventSource | undefined
  let maybeAbort: AbortController | undefined

  const closeEventSource = () => {
    if (maybeEventSource) {
      maybeEventSource.close()
      maybeEventSource = undefined
    }
  }

  const cancel = () => {
    closeEventSource()
    if (maybeAbort) {
      maybeAbort.abort()
      maybeAbort = undefined
    }
  }

  const startClone = (url: string, branch?: string) => {
    cancel()

    const baseUrl = server.url
    if (!baseUrl) {
      options.onError("Server URL unavailable")
      return
    }

    const params = new URLSearchParams({ url })
    if (branch?.trim()) params.set("branch", branch.trim())

    const eventSource = new EventSource(`${baseUrl}/repo/clone-progress?${params.toString()}`, {
      withCredentials: true,
    })
    let receivedFinalEvent = false

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RepoCloneProgress
        options.onProgress(data)
      } catch {
        options.onError("Failed to parse clone progress")
      }
    }

    eventSource.addEventListener("complete", (event) => {
      receivedFinalEvent = true
      closeEventSource()
      try {
        const messageEvent = event as MessageEvent
        const data = JSON.parse(messageEvent.data) as { repo: Repo; message: string }
        options.onComplete(data.repo, data.message)
      } catch {
        options.onError("Clone completed but failed to update UI")
      }
    })

    eventSource.addEventListener("clone_error", (event) => {
      receivedFinalEvent = true
      closeEventSource()
      try {
        const messageEvent = event as MessageEvent
        const data = JSON.parse(messageEvent.data) as {
          message: string
          help_steps?: string[]
          auth_type?: CloneAuthType
          can_retry_with_credentials?: boolean
        }
        options.onError(data.message, data.help_steps, data.auth_type, data.can_retry_with_credentials)
      } catch {
        options.onError("Clone failed")
      }
    })

    eventSource.addEventListener("error", () => {
      if (!receivedFinalEvent) {
        options.onError("Connection to the server was lost")
      }
      closeEventSource()
    })

    maybeEventSource = eventSource
  }

  const startCloneWithCredentials = async (url: string, credentials: RepoCloneCredentials, branch?: string) => {
    cancel()
    maybeAbort = new AbortController()

    const baseUrl = server.url
    if (!baseUrl) {
      options.onError("Server URL unavailable")
      return
    }

    try {
      const requestFetch = platform.fetch ?? fetch
      const response = await requestFetch(`${baseUrl}/repo/clone-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, credentials, branch: branch?.trim() || undefined }),
        signal: maybeAbort.signal,
      })

      if (!response.ok || !response.body) {
        options.onError("Failed to start clone")
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""

        for (const chunk of chunks) {
          const dataMatch = chunk.match(/^data:\s*(.+)$/m)
          if (!dataMatch) continue
          try {
            const data = JSON.parse(dataMatch[1]) as
              | { type: "progress"; data: RepoCloneProgress }
              | { type: "complete"; data: { repo: Repo; message: string } }
              | {
                  type: "error"
                  data: {
                    message: string
                    help_steps?: string[]
                    auth_type?: CloneAuthType
                    can_retry_with_credentials?: boolean
                  }
                }
            if (data.type === "progress") {
              options.onProgress(data.data)
            } else if (data.type === "complete") {
              options.onComplete(data.data.repo, data.data.message)
              return
            } else if (data.type === "error") {
              options.onError(
                data.data.message,
                data.data.help_steps,
                data.data.auth_type,
                data.data.can_retry_with_credentials,
              )
              return
            }
          } catch {
            options.onError("Failed to parse clone progress")
          }
        }
      }
    } catch {
      options.onError("Connection error")
    } finally {
      maybeAbort = undefined
    }
  }

  onCleanup(cancel)

  return { startClone, startCloneWithCredentials, cancel }
}
