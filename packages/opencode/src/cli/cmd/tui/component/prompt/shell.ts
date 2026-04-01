export function shellAction(name: string | undefined, offset: number) {
  if ((name === "backspace" && offset === 0) || name === "escape") return "normal"
  if (name === "tab") return "consume"
}
