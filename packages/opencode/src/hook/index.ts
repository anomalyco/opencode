import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"
import { spawn } from "child_process"

const DEFAULT_TIMEOUT_MS = 30_000
const INPUT_REQUIRED_THROTTLE_MS = 1_000
const MAX_STDERR = 8 * 1024

export namespace Hook {
  const log = Log.create({ service: "hook" })

  // Track previous status per session to detect transitions
  const previousStatus = new Map<string, SessionStatus.Info["type"]>()

  // Global in-flight flag: mute new triggers while a hook run is active (shared between session_completed and input_required)
  let running = false

  // Leading throttle window for input_required hooks
  let inputRequiredMuteUntil = 0

  export function init() {
    log.info("init")
    initSessionCompleted()
    initInputRequired()
  }

  function initSessionCompleted() {
    Bus.subscribe(SessionStatus.Event.Status, async (evt) => {
      const { sessionID, status } = evt.properties
      const prevType = previousStatus.get(sessionID)

      log.info("status event", { sessionID, status: status.type, prevType })

      // Update tracked status (delete on idle to avoid memory leak)
      if (status.type === "idle") {
        previousStatus.delete(sessionID)
      } else {
        previousStatus.set(sessionID, status.type)
      }

      // Only trigger on non-idle → idle transitions
      if (status.type !== "idle") return
      if (prevType === undefined || prevType === "idle") return // Was already idle or unknown
      if (running) return // Mute while another hook run is in progress

      log.info("triggering session_completed hooks", { sessionID, prevType })

      const config = await Config.get().catch(() => undefined)
      if (!config) return
      const hooks = config.experimental?.hook?.session_completed
      if (!hooks?.length) {
        log.info("no session_completed hooks configured")
        return
      }

      log.info("running session_completed hooks", { count: hooks.length })

      running = true
      try {
        const session = await Session.get(sessionID).catch(() => undefined)
        for (const hook of hooks) {
          log.info("executing hook", { command: hook.command })
          await runHook(hook, {
            SESSION_ID: sessionID,
            SESSION_TITLE: session?.title ?? "",
            PROJECT_DIR: Instance.directory,
            OPENCODE_CWD: Instance.directory,
          })
        }
      } finally {
        running = false
      }
    })
  }

  function initInputRequired() {
    // Subscribe to permission.asked
    Bus.subscribe(PermissionNext.Event.Asked, async (evt) => {
      log.info("permission.asked event", { sessionID: evt.properties.sessionID, permission: evt.properties.permission })
      scheduleInputRequired({
        sessionID: evt.properties.sessionID,
        inputType: "permission_required",
        permissionName: evt.properties.permission,
      })
    })

    // Subscribe to question.asked
    Bus.subscribe(Question.Event.Asked, async (evt) => {
      log.info("question.asked event", { sessionID: evt.properties.sessionID })
      scheduleInputRequired({
        sessionID: evt.properties.sessionID,
        inputType: "question_asked",
        questionHeader: evt.properties.questions[0]?.header,
      })
    })
  }

  function scheduleInputRequired(input: {
    sessionID: string
    inputType: "permission_required" | "question_asked"
    permissionName?: string
    questionHeader?: string
  }) {
    // Skip if hooks are currently running (shared lock)
    if (running) {
      log.info("input_required muted, hooks running")
      return
    }

    const now = Date.now()
    if (now < inputRequiredMuteUntil) {
      log.info("input_required muted", {
        reason: "throttle",
        now,
        until: inputRequiredMuteUntil,
        inputType: input.inputType,
      })
      return
    }

    inputRequiredMuteUntil = now + INPUT_REQUIRED_THROTTLE_MS
    void triggerInputRequired(input)
  }

  async function triggerInputRequired(input: {
    sessionID: string
    inputType: "permission_required" | "question_asked"
    permissionName?: string
    questionHeader?: string
  }) {
    const config = await Config.get().catch(() => undefined)
    if (!config) return

    const hooks = config.experimental?.hook?.input_required
    if (!hooks?.length) {
      log.info("no input_required hooks configured")
      return
    }

    log.info("running input_required hooks", { count: hooks.length, inputType: input.inputType })

    running = true
    try {
      const session = await Session.get(input.sessionID).catch(() => undefined)
      for (const hook of hooks) {
        log.info("executing input_required hook", { command: hook.command })

        const extraEnv: Record<string, string> = {
          SESSION_ID: input.sessionID,
          SESSION_TITLE: session?.title ?? "",
          PROJECT_DIR: Instance.directory,
          OPENCODE_CWD: Instance.directory,
          INPUT_TYPE: input.inputType,
        }

        if (input.inputType === "permission_required" && input.permissionName) {
          extraEnv.PERMISSION_NAME = input.permissionName
        }
        if (input.inputType === "question_asked" && input.questionHeader) {
          extraEnv.QUESTION_HEADER = input.questionHeader
        }

        await runHook(hook, extraEnv)
      }
    } finally {
      running = false
    }
  }

  async function runHook(
    hook: { command: string[]; environment?: Record<string, string>; timeout?: number },
    extraEnv: Record<string, string>,
  ) {
    const [cmd, ...args] = hook.command
    const proc = spawn(cmd, args, {
      cwd: Instance.directory,
      env: { ...process.env, ...hook.environment, ...extraEnv },
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    })

    let stderr = ""
    let exited = false
    let timedOut = false

    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) {
        stderr += chunk.toString()
      }
    })

    const kill = () => Shell.killTree(proc, { exited: () => exited })

    const timeoutMs = hook.timeout ?? DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => {
      timedOut = true
      void kill()
    }, timeoutMs)

    const exit = await new Promise<number | null>((resolve) => {
      proc.once("exit", (code) => {
        exited = true
        clearTimeout(timer)
        resolve(code)
      })
      proc.once("error", () => {
        exited = true
        clearTimeout(timer)
        resolve(null)
      })
    })

    if (exit !== 0 || timedOut) {
      const truncated = stderr.length > MAX_STDERR ? stderr.slice(0, MAX_STDERR) + "..." : stderr
      log.warn("hook failed", {
        command: hook.command,
        exit,
        timedOut,
        stderr: truncated,
      })
    }
  }

  // Test helpers
  export const _test = {
    reset: () => {
      previousStatus.clear()
      running = false
      inputRequiredMuteUntil = 0
    },
  }
}
