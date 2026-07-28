// Serial prompt queue for direct interactive mode.
//
// Prompts arrive from the footer (user types and hits enter) and local
// operations drain one at a time. Ordinary prompts submitted during an active
// ordinary turn are admitted immediately to the server's durable queue.
//
// The queue also handles local session commands, empty-prompt rejection,
// and tracks per-turn wall-clock duration for the footer status line.
//
// Resolves when the footer closes and all in-flight work finishes.
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Locale } from "../util/locale"
import { isCompactCommand, isExitCommand, isNewCommand } from "./prompt.shared"
import type { FooterApi, FooterEvent, RunPrompt } from "./types"

type Trace = {
  write(type: string, data?: unknown): void
}

export type QueueInput = {
  footer: FooterApi
  initialInput?: string
  trace?: Trace
  onSend?: (prompt: RunPrompt, delivery: "steer" | "queue") => void
  onAdmissionError?: (prompt: RunPrompt, error: unknown) => void | Promise<void>
  onNewSession?: () => void | Promise<void>
  onCompact?: () => void | Promise<void>
  admit: (prompt: RunPrompt, signal: AbortSignal) => Promise<void>
  settle: () => Promise<void>
  run: (prompt: RunPrompt, signal: AbortSignal, admitted: () => void) => Promise<void>
}

type State = {
  queue: RunPrompt[]
  active?: RunPrompt
  admission?: Promise<void>
  ctrl?: AbortController
  closed: boolean
}

// Runs the prompt queue until the footer closes.
//
// Subscribes to footer prompt events and drains operations through input.run().
// Ordinary prompts submitted during an ordinary active turn are admitted as
// durable queued work instead of remaining editable process-local state.
export async function runPromptQueue(input: QueueInput): Promise<void> {
  const stop = Promise.withResolvers<{ type: "closed" }>()
  const done = Promise.withResolvers<void>()
  const state: State = {
    queue: [],
    closed: input.footer.isClosed,
  }
  let draining: Promise<void> | undefined
  let admissions = Promise.resolve()
  let admissionVersion = 0
  const admissionController = new AbortController()

  const emit = (next: FooterEvent, row: Record<string, unknown>) => {
    input.trace?.write("ui.patch", row)
    input.footer.event(next)
  }

  const finish = () => {
    if (!state.closed || draining) {
      return
    }

    done.resolve()
  }

  const close = () => {
    if (state.closed) {
      return
    }

    state.closed = true
    state.queue.length = 0
    // Ordinary turn signals map to session.interrupt; exiting should only detach the TUI.
    if (state.active?.mode === "shell") state.ctrl?.abort()
    admissionController.abort()
    stop.resolve({ type: "closed" })
    finish()
  }

  const drain = () => {
    if (draining || state.closed || state.queue.length === 0) {
      return
    }

    draining = (async () => {
      try {
        while (!state.closed && state.queue.length > 0) {
          const prompt = state.queue.shift()
          if (!prompt) {
            continue
          }

          if (prompt.mode !== "shell" && isNewCommand(prompt.text)) {
            if (!input.onNewSession) {
              emit(
                {
                  type: "stream.patch",
                  patch: {
                    status: "new sessions unavailable",
                  },
                },
                {
                  status: "new sessions unavailable",
                },
              )
              continue
            }

            emit(
              {
                type: "stream.patch",
                patch: {
                  phase: "running",
                  status: "starting new session",
                },
              },
              {
                phase: "running",
                status: "starting new session",
              },
            )
            await input.onNewSession()
            continue
          }

          if (prompt.mode !== "shell" && isCompactCommand(prompt.text)) {
            emit(
              {
                type: "stream.patch",
                patch: {
                  phase: "running",
                  status: "compacting session",
                },
              },
              {
                phase: "running",
                status: "compacting session",
              },
            )
            await input.onCompact?.()
            continue
          }

          const sent =
            prompt.mode === "shell"
              ? prompt
              : {
                  ...prompt,
                  messageID: prompt.messageID ?? SessionMessage.ID.create(),
                }
          state.active = sent

          emit(
            { type: "turn.send" },
            {
              phase: "running",
              status: "sending prompt",
            },
          )
          const start = Date.now()
          const ctrl = new AbortController()
          const admission = Promise.withResolvers<void>()
          const version = admissionVersion
          state.ctrl = ctrl
          state.admission = admission.promise

          try {
            await input.footer.idle()
            if (state.closed) {
              break
            }

            if (sent.mode !== "shell") {
              const commit = {
                kind: "user",
                text: sent.text,
                phase: "start",
                source: "system",
                messageID: sent.messageID,
              } as const
              input.trace?.write("ui.commit", commit)
              input.footer.append(commit)
            }
            input.onSend?.(sent, "steer")

            if (state.closed) {
              break
            }

            const task = input.run(sent, ctrl.signal, admission.resolve).then(
              () => ({ type: "done" as const }),
              (error) => ({ type: "error" as const, error }),
            )

            const next = await Promise.race([task, stop.promise])
            if (next.type === "closed") {
              break
            }

            if (next.type === "error") {
              throw next.error
            }
            if (sent.mode !== "shell" && admissionVersion !== version) {
              do {
                const current = admissionVersion
                await admissions
                if (state.closed) break
                await input.settle()
                if (current === admissionVersion) break
              } while (!state.closed)
            }
          } finally {
            admission.resolve()
            if (state.ctrl === ctrl) {
              state.ctrl = undefined
            }
            if (state.admission === admission.promise) state.admission = undefined

            if (sent.mode !== "shell") {
              const duration = Locale.duration(Math.max(0, Date.now() - start))
              emit(
                {
                  type: "turn.duration",
                  duration,
                },
                {
                  duration,
                },
              )
            }
            state.active = undefined
          }
        }
      } catch (error) {
        done.reject(error)
        return
      } finally {
        draining = undefined
        emit(
          { type: "turn.idle" },
          {
            phase: "idle",
            status: "",
          },
        )
      }

      finish()
    })()
  }

  const submit = (prompt: RunPrompt) => {
    if (!prompt.text.trim() || state.closed) {
      return
    }

    if (prompt.mode !== "shell" && isExitCommand(prompt.text)) {
      input.footer.close()
      return
    }

    const active = state.active
    if (
      active &&
      active.mode !== "shell" &&
      prompt.mode !== "shell" &&
      prompt.command?.source !== "skill" &&
      !isNewCommand(prompt.text) &&
      !isCompactCommand(prompt.text) &&
      !state.queue.some(
        (item) => item.mode !== "shell" && (isNewCommand(item.text) || isCompactCommand(item.text)),
      )
    ) {
      const sent = { ...prompt, messageID: SessionMessage.ID.create() }
      const admission = state.admission
      admissionVersion += 1
      input.onSend?.(sent, "queue")
      admissions = admissions
        .then(() => admission)
        .then(() => input.admit(sent, admissionController.signal))
        .catch((error) => (state.closed ? undefined : input.onAdmissionError?.(sent, error)))
      return
    }

    state.queue.push(prompt)
    if (prompt.mode !== "shell" && (isNewCommand(prompt.text) || isCompactCommand(prompt.text))) {
      drain()
      return
    }

    emit(
      {
        type: "first",
        first: false,
      },
      {
        first: false,
      },
    )
    drain()
  }

  const offPrompt = input.footer.onPrompt((prompt) => {
    submit(prompt)
  })
  const offClose = input.footer.onClose(() => {
    close()
  })
  try {
    if (state.closed) {
      return
    }

    submit({
      text: input.initialInput ?? "",
      parts: [],
    })
    finish()
    await done.promise
  } finally {
    offPrompt()
    offClose()
    close()
    await draining?.catch(() => {})
    await admissions
  }
}
