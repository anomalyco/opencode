export const SESSION_HOOK_CONTROL_COMMANDS = {
  stop: "stop-hooks",
  resume: "resume-hooks",
} as const

export function sessionHookControlInput(enabled: boolean) {
  return {
    plugin: "*",
    hook: "*",
    enabled,
  }
}

export function sessionHookControlCommand(text: string) {
  const trimmed = text.trim()
  if (trimmed === `/${SESSION_HOOK_CONTROL_COMMANDS.stop}`) return "stop"
  if (trimmed === `/${SESSION_HOOK_CONTROL_COMMANDS.resume}`) return "resume"
  return undefined
}
