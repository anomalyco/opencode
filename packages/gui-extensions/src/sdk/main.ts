import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import { Host, Point, type Cleanup } from "./core"

export * from "./core"

export interface Windows {
  get(id: number): BrowserWindow | undefined
  list(): readonly BrowserWindow[]
  focused(): BrowserWindow | undefined
  on(event: "open" | "close", handler: (window: BrowserWindow) => void): Cleanup
}

export interface Surface {
  readonly id: string
  /** Page-side gate. The view shows only while the renderer lays it out AND show(true). */
  show(visible: boolean): void
  /** Runs when the view goes on or off screen, including when the renderer paints a still in its place. */
  on(event: "visible", handler: (visible: boolean) => void): Cleanup
  capture(): Promise<NativeImage | undefined>
  dispose(): void
}

export interface Surfaces {
  /** The renderer presents it with the renderer SDK's `Surfaces.View`; the host owns bounds, zoom, corners, and occlusion. */
  create(view: WebContentsView, window: BrowserWindow): Surface
}

export interface MainStorage {
  /** Values are stored as the schema's canonical JSON; the schema must not need services. */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: { readonly schema: S; readonly initial: S["Type"]; readonly from?: string },
  ): {
    get(): S["Type"]
    set(value: S["Type"]): void
    /** Deletes the value and the older copy `from` names, so the key reads as `initial` again. */
    remove(): void
  }
}

export interface MainServer {
  readonly id: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** Same machine as this app's own server. Loopback HTTP alone does not qualify. */
  readonly local: boolean
  /** Credentials a window configured for the server; `headers` already carries them. None for the app's own server. */
  readonly username?: string
  readonly password?: string
}

export interface Cli {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
  readonly development: boolean
}

export interface MainApp {
  readonly version: string
  readonly channel: string
  readonly packaged: boolean
  server(id: string): MainServer | undefined
  /**
   * Marks the app as quitting and disposes every other extension, then runs handoff (e.g. quitAndInstall) or
   * relaunches. The caller stays active through the handoff and keeps running when it fails (the promise rejects).
   */
  restart(handoff?: () => void | Promise<void>): Promise<void>
  /** Writes to the desktop log file (included in exported debug logs). */
  log(level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void
}

export interface Menubar {
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  readonly id: string
  readonly label: string
  readonly after?: string
  readonly enabled?: () => boolean
  run(window: BrowserWindow | undefined): void
}

export const Windows = Host.define<Windows>("window")
export const Surfaces = Host.define<Surfaces>("surface")
export const MainStorage = Host.define<MainStorage>("storage")
export const Cli = Host.define<Cli>("cli")
export const MainApp = Host.define<MainApp>("app")
export const Menubar = Point.define<Menubar>("menubar")
