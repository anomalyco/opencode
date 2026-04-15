declare module "@npmcli/arborist" {
  export interface ArboristOptions {
    path: string
    binLinks?: boolean
    progress?: boolean
    savePrefix?: string
    ignoreScripts?: boolean
  }

  export interface ArboristNode {
    name: string
    path: string
  }

  export interface ArboristEdge {
    to?: ArboristNode
  }

  export interface ArboristTree {
    edgesOut: Map<string, ArboristEdge>
  }

  export interface ReifyOptions {
    add?: string[]
    save?: boolean
    saveType?: "prod" | "dev" | "optional" | "peer"
  }

  export class Arborist {
    constructor(options: ArboristOptions)
    loadVirtual(): Promise<ArboristTree | undefined>
    reify(options?: ReifyOptions): Promise<ArboristTree>
  }
}

declare var Bun:
  | {
      file(path: string): {
        text(): Promise<string>
        json(): Promise<unknown>
      }
      write(path: string, content: string | Uint8Array): Promise<void>
    }
  | undefined
