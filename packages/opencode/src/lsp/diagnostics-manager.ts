import { z } from "zod"
import { Bus } from "../bus"
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"

export namespace DiagnosticsManager {
  const log = Log.create({ service: "lsp.diagnostics" })

  export type Diagnostic = VSCodeDiagnostic

  export const Event = {
    Updated: Bus.event(
      "lsp.diagnostics.updated",
      z.object({
        serverID: z.string(),
        path: z.string(),
      }),
    ),
  }

  export interface DiagnosticsStore {
    get(path: string): Diagnostic[]
    set(path: string, diagnostics: Diagnostic[]): void
    has(path: string): boolean
    delete(path: string): void
    clear(): void
    entries(): IterableIterator<[string, Diagnostic[]]>
  }

  export class Manager {
    private store: Map<string, Diagnostic[]> = new Map()
    private subscribers: Set<(path: string) => void> = new Set()

    constructor(
      private serverID: string,
      private options: {
        suppressInitialEvents?: boolean
      } = {}
    ) {}

    onDiagnosticsUpdate(params: { uri: string; diagnostics: Diagnostic[] }): void {
      const path = new URL(params.uri).pathname
      
      log.info("diagnostics update", {
        serverID: this.serverID,
        path,
        count: params.diagnostics.length,
      })

      const isNew = !this.store.has(path)
      this.store.set(path, params.diagnostics)

      // Suppress initial events for TypeScript server
      if (isNew && this.options.suppressInitialEvents && this.serverID === "typescript") {
        return
      }

      // Notify subscribers
      this.subscribers.forEach(callback => callback(path))

      // Publish bus event
      Bus.publish(Event.Updated, { 
        path, 
        serverID: this.serverID 
      })
    }

    subscribe(callback: (path: string) => void): () => void {
      this.subscribers.add(callback)
      return () => this.subscribers.delete(callback)
    }

    get(path: string): Diagnostic[] {
      return this.store.get(path) || []
    }

    has(path: string): boolean {
      return this.store.has(path)
    }

    delete(path: string): void {
      this.store.delete(path)
    }

    clear(): void {
      this.store.clear()
    }

    entries(): IterableIterator<[string, Diagnostic[]]> {
      return this.store.entries()
    }

    async waitForDiagnostics(
      path: string,
      timeout: number
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        let unsubscribeBus: (() => void) | undefined
        let unsubscribeLocal: (() => void) | undefined
        let timer: NodeJS.Timeout | undefined

        const cleanup = () => {
          unsubscribeBus?.()
          unsubscribeLocal?.()
          if (timer) clearTimeout(timer)
        }

        // Set up timeout
        timer = setTimeout(() => {
          cleanup()
          log.warn("diagnostics timeout", { 
            path, 
            serverID: this.serverID,
            timeout 
          })
          resolve() // Resolve instead of reject for graceful degradation
        }, timeout)

        // Subscribe to both local and bus events for redundancy
        unsubscribeLocal = this.subscribe((updatedPath) => {
          if (updatedPath === path) {
            log.info("got diagnostics (local)", { 
              path,
              serverID: this.serverID 
            })
            cleanup()
            resolve()
          }
        })

        unsubscribeBus = Bus.subscribe(Event.Updated, (event) => {
          if (event.properties.path === path && 
              event.properties.serverID === this.serverID) {
            log.info("got diagnostics (bus)", { 
              path,
              serverID: this.serverID 
            })
            cleanup()
            resolve()
          }
        })
      })
    }
  }
}