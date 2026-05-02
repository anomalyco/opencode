export namespace ShellKind {
  export const ids = ["bash", "pwsh", "powershell", "cmd"] as const
  export type ID = (typeof ids)[number]

  const kind = new Set<string>(ids)
  const ps = new Set<string>(["pwsh", "powershell"])

  export function has(value: string): value is ID {
    return kind.has(value)
  }

  export function from(value: string): ID {
    return has(value) ? value : "bash"
  }

  export function powershell(value: string) {
    return ps.has(value)
  }
}

export namespace ShellToolID {
  export const id = "bash"
  export type ID = typeof id

  export function has(value: string): value is ID {
    return value === id
  }
}
