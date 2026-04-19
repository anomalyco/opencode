import { wrapOscSequence } from "./osc"

const MAX_LENGTH = 180

export const NOTIFICATION_METHODS = ["auto", "osc9", "osc777", "bell", "off"] as const

export type NotificationMethod = (typeof NOTIFICATION_METHODS)[number]

export function resolveNotificationMethod(
  method: NotificationMethod | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Exclude<NotificationMethod, "auto"> {
  if (method && method !== "auto") return method
  if (env.TERM_PROGRAM === "vscode") return "bell"
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return "osc777"
  if (env.TERM_PROGRAM === "WezTerm") return "osc777"
  if (env.VTE_VERSION || env.TERM?.startsWith("foot")) return "osc777"
  if (env.TERM_PROGRAM === "iTerm.app") return "osc9"
  if (env.TERM_PROGRAM === "ghostty") return "osc9"
  if (env.TERM_PROGRAM === "Apple_Terminal") return "osc9"
  if (env.TERM_PROGRAM === "WarpTerminal") return "osc9"
  if (env.WT_SESSION) return "bell"
  return "bell"
}

function sanitizeNotificationText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/;/g, ":")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH)
}

function formatNotificationSequence(input: {
  method: Exclude<NotificationMethod, "auto">
  title: string
  body?: string
}) {
  if (input.method === "off") return ""
  if (input.method === "bell") return "\x07"
  if (input.method === "osc9") {
    return `\x1b]9;${sanitizeNotificationText([input.title, input.body].filter(Boolean).join(": "))}\x07`
  }
  return `\x1b]777;notify;${sanitizeNotificationText(input.title)};${sanitizeNotificationText(input.body ?? "")}\x07`
}

export function notifyTerminal(input: {
  title: string
  body?: string
  method?: NotificationMethod
  env?: NodeJS.ProcessEnv
  write?: (chunk: string) => void
}) {
  const env = input.env ?? process.env
  const method = resolveNotificationMethod(input.method, env)
  const sequence = wrapOscSequence(
    formatNotificationSequence({
      method,
      title: input.title,
      body: input.body,
    }),
    env,
  )
  if (!sequence) return false
  const write =
    input.write ??
    ((chunk: string) => (process.stderr.isTTY ? process.stderr.write(chunk) : process.stdout.write(chunk)))
  write(sequence)
  return true
}
