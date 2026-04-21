declare module "@npmcli/config" {
  type Data = Record<string, unknown>
  type Where = "default" | "builtin" | "global" | "user" | "project" | "env" | "cli"

  namespace Config {
    interface Options {
      definitions: Data
      shorthands: Record<string, string | string[]>
      npmPath: string
      flatten?: (input: Data, flat?: Data) => Data
      nerfDarts?: string[]
      argv?: string[]
      cwd?: string
      env?: NodeJS.ProcessEnv
      execPath?: string
      platform?: NodeJS.Platform
      warn?: boolean
    }
  }

  class Config {
    constructor(input: Config.Options)

    readonly data: Map<Where, { source: string | null }>
    readonly flat: Data

    load(): Promise<void>
  }

  export = Config
}

declare module "@npmcli/config/lib/definitions" {
  export const definitions: Record<string, unknown>
  export const shorthands: Record<string, string | string[]>
  export const flatten: (input: Record<string, unknown>, flat?: Record<string, unknown>) => Record<string, unknown>
  export const nerfDarts: string[]
  export const proxyEnv: string[]
}

declare module "@npmcli/config/lib/definitions/index.js" {
  export * from "@npmcli/config/lib/definitions"
}
