declare module "@npmcli/config" {
  type Data = Record<string, unknown>
  type Where = "default" | "builtin" | "global" | "user" | "project" | "env" | "cli"

  export default class Config {
    constructor(input: {
      argv: string[]
      cwd: string
      definitions: Data
      env: NodeJS.ProcessEnv
      execPath: string
      flatten: (input: Data, flat?: Data) => Data
      npmPath: string
      platform: NodeJS.Platform
      shorthands: Record<string, string[]>
      warn?: boolean
    })

    readonly data: Map<Where, { source: string | null }>
    readonly flat: Data
    load(): Promise<void>
  }
}

declare module "@npmcli/config/lib/definitions/index.js" {
  export const definitions: Record<string, unknown>
  export const shorthands: Record<string, string[]>
  export const flatten: (input: Record<string, unknown>, flat?: Record<string, unknown>) => Record<string, unknown>
}
