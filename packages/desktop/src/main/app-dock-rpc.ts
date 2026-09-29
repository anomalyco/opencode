import type { BrowserWindow } from "electron"
import type { AppDock, DockBounds } from "./app-dock"

export type DockRPCReply = (message: unknown) => void

type DockRPCRequest = Readonly<{
  type: "dock.rpc"
  id: string
  op: string
  args: Record<string, unknown>
}>

type DockRPCResult =
  | Readonly<{ type: "dock.rpc.result"; id: string; ok: true; value: unknown }>
  | Readonly<{ type: "dock.rpc.result"; id: string; ok: false; error: Readonly<{ message: string }> }>

const sendResult = (reply: DockRPCReply, result: DockRPCResult) => reply(result)

const errorResult = (id: string, message: string): DockRPCResult =>
  Object.freeze({ type: "dock.rpc.result", id, ok: false, error: Object.freeze({ message }) })

const isDockRPCRequest = (value: unknown): value is DockRPCRequest => {
  if (!value || typeof value !== "object") return false
  const request = value as Partial<DockRPCRequest>
  if (request.type !== "dock.rpc") return false
  if (typeof request.id !== "string" || request.id.length === 0) return false
  if (typeof request.op !== "string" || typeof request.args !== "object" || request.args === null) return false
  return true
}

const dockString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid App Dock ${name}`)
  return value
}

const dockStringArrayArg = (args: Record<string, unknown>, name: string, defaultValue: string[] = []) => {
  const value = args[name]
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.length > 0) return [value]
  return defaultValue
}

const dockNumber = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid App Dock ${name}`)
  return Math.max(min, Math.min(max, Math.round(value)))
}
const dockRef = (value: unknown, name: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid App Dock ${name}`)
  return value
}

export class AppDockRPC {
  private appDock: AppDock | undefined
  private dockWindow: BrowserWindow | undefined
  private dockDestroyHooks = new Set<number>()
  private profileResolver: (senderID: number) => { profileID: string; storageKey: string } = (senderID: number) => ({
    profileID: "default",
    storageKey: `dock-bridge-${senderID}-default`,
  })

  setAppDock(instance: AppDock) {
    this.appDock = instance
  }

  setWindow(win: BrowserWindow) {
    if (this.dockWindow && !this.dockWindow.isDestroyed()) return
    this.dockWindow = win
    win.once("closed", () => {
      if (this.dockWindow === win) this.dockWindow = undefined
    })
  }

  setProfileResolver(resolver: (senderID: number) => { profileID: string; storageKey: string }) {
    this.profileResolver = resolver
  }

  reset() {
    this.appDock = undefined
    this.dockWindow = undefined
    this.dockDestroyHooks.clear()
    this.profileResolver = (senderID: number) => ({
      profileID: "default",
      storageKey: `dock-bridge-${senderID}-default`,
    })
  }

  private dockSender(): { senderID: number; win: BrowserWindow } {
    const win = this.dockWindow
    if (!win || win.isDestroyed()) throw new Error("No window is available for App Dock")
    return { senderID: win.webContents.id, win }
  }

  handleDockRPC(message: unknown, reply: DockRPCReply): boolean {
    if (!isDockRPCRequest(message)) return false
    const { id, op, args } = message
    const promise = this.dispatch(op, args)
      .then((value) => sendResult(reply, Object.freeze({ type: "dock.rpc.result", id, ok: true, value })))
      .catch((error) => sendResult(reply, errorResult(id, error instanceof Error ? error.message : String(error))))
    promise.catch(() => {})
    return true
  }

  private async dispatch(op: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.appDock) throw new Error("App Dock bridge is not initialized")
    const dock = this.appDock
    const { senderID, win } = this.dockSender()

    switch (op) {
      case "list": {
        return dock.list(senderID)
      }
      case "activate": {
        const tabID = dockString(args.tabID, "tabID")
        dock.activate(senderID, win, tabID)
        return dock.list(senderID)
      }
      case "read": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const budget = args.budget === undefined ? 100 : dockNumber(args.budget, "budget", 1, 500)
        const maxText = args.maxText === undefined ? 1500 : dockNumber(args.maxText, "maxText", 0, 20000)
        return dock.read(senderID, tabID, budget, maxText)
      }
      case "click": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const ref = dockRef(args.ref, "element ref")
        return dock.click(senderID, tabID, ref)
      }
      case "type": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const ref = dockRef(args.ref, "element ref")
        const text = dockString(args.text, "text")
        return dock.type(senderID, tabID, ref, text)
      }
      case "navigate": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const address = dockString(args.address, "address")
        return dock.navigate(senderID, tabID, address)
      }
      case "go": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const command = dockString(args.command, "command")
        if (command !== "back" && command !== "forward" && command !== "reload")
          throw new Error("Invalid App Dock command")
        return dock.command(senderID, tabID, command)
      }
      case "open": {
        const address = dockString(args.address, "address")
        const profile = this.profileResolver(senderID)
        const tab = await dock.open(
          senderID,
          win,
          address,
          dockBounds(win, args.bounds),
          (event) => {
            if (!win.isDestroyed()) win.webContents.send("app-dock-event", event)
          },
          { storageKey: profile.storageKey },
        )
        if (!this.dockDestroyHooks.has(senderID)) {
          this.dockDestroyHooks.add(senderID)
          win.webContents.once("destroyed", () => {
            this.dockDestroyHooks.delete(senderID)
            this.appDock?.closeAll(senderID, win)
          })
        }
        win.webContents.send("app-dock-event", { type: "tab-opened", payload: tab })
        return tab
      }
      case "close": {
        const tabID = args.tabID === undefined ? undefined : dockString(args.tabID, "tabID")
        dock.close(senderID, win, tabID)
        return dock.list(senderID)
      }
      case "scroll": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const direction = dockString(args.direction, "direction")
        if (direction !== "up" && direction !== "down" && direction !== "top" && direction !== "bottom")
          throw new Error("Invalid App Dock direction")
        const amount = args.amount === undefined ? undefined : dockNumber(args.amount, "amount", 1, 10000)
        if (amount !== undefined && (direction === "top" || direction === "bottom"))
          throw new Error("Invalid App Dock amount for scroll to edge")
        return dock.scroll(senderID, tabID, direction, amount)
      }
      case "hover": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const ref = dockRef(args.ref, "element ref")
        return dock.hover(senderID, tabID, ref)
      }
      case "drag": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const fromRef = dockRef(args.fromRef, "from ref")
        const toRef = dockRef(args.toRef, "to ref")
        return dock.drag(senderID, tabID, fromRef, toRef)
      }
      case "clickAt": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const x = dockNumber(args.x, "x", 0, 10000)
        const y = dockNumber(args.y, "y", 0, 10000)
        return dock.clickAt(senderID, tabID, x, y)
      }
      case "scrollTo": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const x = dockNumber(args.x, "x", 0, 10000)
        const y = dockNumber(args.y, "y", 0, 10000)
        return dock.scrollTo(senderID, tabID, x, y)
      }
      case "storage": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const storage = dockString(args.storage, "storage")
        if (storage !== "local" && storage !== "session") throw new Error("Invalid App Dock storage")
        const key = dockString(args.key, "key")
        return dock.storage(senderID, tabID, storage, key)
      }
      case "evaluate": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const script = dockString(args.script, "script")
        return dock.evaluate(senderID, tabID, script)
      }
      case "network": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const blockUrls = dockStringArrayArg(args, "blockUrls")
        const allowedOrigins = dockStringArrayArg(args, "allowedOrigins")
        const blockMethods = dockStringArrayArg(args, "blockMethods")
        const probeUrl = args.probeUrl === undefined ? undefined : dockString(args.probeUrl, "probeUrl")
        const probeMethod = args.probeMethod === undefined ? undefined : dockString(args.probeMethod, "probeMethod")
        const config = { blockUrls, allowedOrigins, blockMethods, probeUrl, probeMethod }
        return dock.network(senderID, tabID, config)
      }
      case "wait": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const milliseconds = args.milliseconds === undefined ? 100 : args.milliseconds
        if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 10_000)
          throw new Error("Invalid App Dock milliseconds")
        return dock.wait(senderID, tabID, milliseconds)
      }
      case "screenshot": {
        const tabID = this.resolveTabID(dock, senderID, args)
        return dock.screenshot(senderID, tabID)
      }
      case "keyboard": {
        const tabID = this.resolveTabID(dock, senderID, args)
        const type = dockString(args.type, "type")
        if (type !== "keyDown" && type !== "keyUp") throw new Error("Invalid App Dock keyboard type")
        const key = dockString(args.key, "key")
        return dock.keyboard(senderID, tabID, type, key)
      }
      default:
        throw new Error(`Unknown App Dock operation: ${op}`)
    }
  }

  private resolveTabID(dock: AppDock, senderID: number, args: Record<string, unknown>) {
    if (args.tabID !== undefined) return dockString(args.tabID, "tabID")
    const tabs = dock.list(senderID)
    const active = tabs.find((tab) => typeof tab === "object" && tab !== null && "active" in tab && tab.active === true)
    const target = active ?? tabs[0]
    if (!target) throw new Error("App Dock has no open tabs")
    return target.tabID
  }
}

function dockBounds(win: BrowserWindow, value: unknown): DockBounds {
  if (value === undefined) {
    const bounds = win.getContentBounds()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }
  if (!value || typeof value !== "object") throw new Error("Invalid App Dock bounds")
  const bounds = value as Partial<{ x: number; y: number; width: number; height: number }>
  const x = bounds.x ?? NaN
  const y = bounds.y ?? NaN
  const width = bounds.width ?? NaN
  const height = bounds.height ?? NaN
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Invalid App Dock bounds")
  return { x, y, width, height }
}

const rpc = new AppDockRPC()

export function registerAppDockBridge(instance: AppDock) {
  rpc.setAppDock(instance)
}

export function registerAppDockWindow(win: BrowserWindow) {
  rpc.setWindow(win)
}

export function registerAppDockProfileResolver(resolver: () => { profileID: string; storageKey: string }) {
  rpc.setProfileResolver(resolver)
}

export function resetAppDockRPC() {
  rpc.reset()
}

export function handleDockRPC(message: unknown, reply: DockRPCReply): boolean {
  return rpc.handleDockRPC(message, reply)
}
