const wrapForTmux = (input: string) => {
  if (!Bun.env["TMUX"]) return input
  return `\u001bPtmux;\u001b${input}\u001b\\`
}

export const osc9 = (text: string) => {
  const payload = wrapForTmux(`\u001b]9;${text}\u0007`)

  Bun.stdout.write(payload)
}
