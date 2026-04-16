declare module "@npmcli/config" {
  export type FlatOptions = Record<string, unknown>

  export type ConfigOptions = {
    definitions: Record<string, unknown>
    shorthands: Record<string, unknown>
    flatten: (input: Record<string, unknown>, flat?: FlatOptions) => FlatOptions
    nerfDarts?: string[]
    npmPath: string
    cwd?: string
    argv?: string[]
    env?: NodeJS.ProcessEnv
  }

  export default class Config {
    constructor(options: ConfigOptions)
    load(): Promise<void>
    readonly flat: FlatOptions
  }
}

declare module "@npmcli/config/lib/definitions" {
  const definitions: {
    definitions: Record<string, unknown>
    shorthands: Record<string, unknown>
    flatten: (input: Record<string, unknown>, flat?: Record<string, unknown>) => Record<string, unknown>
    nerfDarts: string[]
  }

  export default definitions
}
