export function tmuxReady(env: NodeJS.ProcessEnv, tmuxPath?: string | null) {
  return !!(env.TMUX && tmuxPath)
}

export function forkKey(sessionID: string) {
  return `fork_prefill:${sessionID}`
}

export function forkCommand(input: { sessionID: string; attachURL?: string; dir?: string }) {
  if (input.attachURL) {
    return [
      "opencode",
      "attach",
      input.attachURL,
      "--session",
      input.sessionID,
      ...(input.dir ? ["--dir", input.dir] : []),
    ]
  }
  return ["opencode", "--session", input.sessionID]
}
