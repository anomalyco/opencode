export function wrapOscSequence(sequence: string, env: NodeJS.ProcessEnv = process.env) {
  if (!sequence) return sequence
  if (!env.TMUX && !env.STY) return sequence
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
}
