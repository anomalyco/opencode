import type { BrowserWindow } from "electron"
import type { AppDockEvent, AppDockState, AppDockTab, AppDockFindResult, DockBounds, ProfileStorage } from "./app-dock"

export interface AppDockAPI {
  open(senderID: number, win: BrowserWindow, address: string, bounds: DockBounds, notify: (event: AppDockEvent) => void, profileStorage: ProfileStorage, replacement?: Readonly<{ tabID: string; selected: boolean }>): Promise<AppDockTab>
  resize(senderID: number, bounds: DockBounds): void
  hide(senderID: number, win: BrowserWindow): void
  select(senderID: number, win: BrowserWindow, tabID: string, bounds: DockBounds): void
  activate(senderID: number, win: BrowserWindow, tabID: string): void
  navigate(senderID: number, tabID: string, address: string): Promise<{ ok: boolean; url: string }>
  execute(senderID: number, tabID: string, script: string): Promise<unknown>
  read(senderID: number, tabID: string, budget: number, maxText: number): Promise<unknown>
  click(senderID: number, tabID: string, ref: number): Promise<unknown>
  type(senderID: number, tabID: string, ref: number, text: string): Promise<unknown>
  close(senderID: number, win: BrowserWindow, tabID?: string): void
  closeAll(senderID: number, win: BrowserWindow): void
  closeTabs(senderID: number, tabID: string, scope: "others" | "right", order?: string[]): void
  list(senderID: number): AppDockState[]
  deleteStorage(storageKey: string, win?: BrowserWindow): Promise<void>
  command(senderID: number, tabID: string, command: "back" | "forward" | "reload"): Promise<{ ok: boolean; navigated: boolean }>
  find(senderID: number, tabID: string, text: string, forward: boolean, notify: (result: AppDockFindResult) => void): number
  stopFind(senderID: number, tabID: string): void
  zoom(senderID: number, tabID: string, factor?: number): number
  fullscreen(senderID: number, win: BrowserWindow, tabID: string, enabled: boolean): Promise<void>
  cancelDownload(senderID: number, id: string): void
  openDownload(senderID: number, id: string): Promise<string>
  openDevTools(senderID: number, tabID: string): void
  recover(senderID: number, tabID: string): Promise<AppDockTab>
  scroll(senderID: number, tabID: string, direction: "up" | "down" | "top" | "bottom", amount?: number): Promise<{ ok: boolean; direction: string; amount: number; before: { x: number; y: number }; after: { x: number; y: number } }>
  hover(senderID: number, tabID: string, ref: number): Promise<unknown>
  drag(senderID: number, tabID: string, fromRef: number, toRef: number): Promise<unknown>
  clickAt(senderID: number, tabID: string, x: number, y: number): Promise<unknown>
  scrollTo(senderID: number, tabID: string, x: number, y: number): Promise<{ ok: boolean; x: number; y: number }>
  storage(senderID: number, tabID: string, storage: "local" | "session", key: string): Promise<{ ok: boolean; storage: "local" | "session"; key: string; value: string | null }>
  pdf(senderID: number, tabID: string): Promise<{ ok: boolean; blob: Blob }>
  frame(senderID: number, tabID: string, direction: "next" | "prev"): Promise<{ ok: boolean; iframe: HTMLIFrameElement }>
  retry(senderID: number, tabID: string, attempts: number, delay: number): Promise<{ ok: boolean; attemptsLeft: number }>
  evaluate(senderID: number, tabID: string, script: string): Promise<{ ok: boolean; result: string }>
  network(senderID: number, tabID: string, config: { blockUrls?: string[]; allowedOrigins?: string[]; blockMethods?: string[]; probeUrl?: string; probeMethod?: string }): Promise<{ ok: boolean; blocked: number; requests: number; interceptorReady: boolean }>
  wait(senderID: number, tabID: string, milliseconds: number): Promise<{ ok: boolean; waitedMs: number }>
  screenshot(senderID: number, tabID: string): Promise<{ mime: "image/png"; bytes: number; prefix: string; sha256: string; data: string }>
  keyboard(senderID: number, tabID: string, type: "keyDown" | "keyUp", key: string): Promise<{ ok: boolean; type: string; key: string }>
}
