import { lazy } from "./lazy.js"

declare module "ffi-napi" {
  export class Library {
    constructor(path: string, functions: Record<string, any>)
    [key: string]: any
  }
}

export namespace X11Clipboard {
  let libX11: any = null
  let libXtst: any = null

  const initializeX11 = lazy(() => {
    try {
      const ffi = require("ffi-napi")

      libX11 = new ffi.Library("libX11", {
        XOpenDisplay: ["pointer", ["string"]],
        XCloseDisplay: ["int", ["pointer"]],
        XDefaultRootWindow: ["ulong", ["pointer"]],
        XGetSelectionOwner: ["ulong", ["pointer", "ulong"]],
        XSetSelectionOwner: ["int", ["pointer", "ulong", "ulong", "uint"]],
        XCreateSimpleWindow: ["ulong", ["pointer", "ulong", "int", "int", "uint", "uint", "uint", "ulong"]],
        XSelectInput: ["int", ["pointer", "ulong", "long"]],
        XNextEvent: ["int", ["pointer", "pointer"]],
        XChangeProperty: ["int", ["pointer", "ulong", "ulong", "int", "int", "int", "pointer", "int"]],
        XGetWindowProperty: [
          "int",
          ["pointer", "ulong", "ulong", "long", "int", "ulong", "int", "pointer", "pointer", "pointer", "pointer"],
        ],
        XDeleteProperty: ["int", ["pointer", "ulong", "ulong"]],
        XConvertSelection: ["int", ["pointer", "ulong", "ulong", "ulong", "ulong", "uint"]],
        XFlush: ["int", ["pointer"]],
        XInternAtom: ["ulong", ["pointer", "string", "int"]],
      })

      libXtst = new ffi.Library("libXtst", {
        XTestFakeKeyEvent: ["void", ["pointer", "uint", "int", "ulong"]],
      })

      return true
    } catch (error) {
      console.log("X11 FFI initialization failed:", error)
      return false
    }
  })

  const getDisplay = lazy(() => {
    if (!initializeX11()) return null
    return libX11.XOpenDisplay(null)
  })

  export async function copy(text: string): Promise<boolean> {
    try {
      const display = getDisplay()
      if (!display) return false

      const clipboardAtom = libX11.XInternAtom(display, "CLIPBOARD", 0)
      const utf8Atom = libX11.XInternAtom(display, "UTF8_STRING", 0)
      const textAtom = libX11.XInternAtom(display, "TEXT", 0)
      const targetsAtom = libX11.XInternAtom(display, "TARGETS", 0)

      const window = libX11.XCreateSimpleWindow(display, libX11.XDefaultRootWindow(display), 0, 0, 1, 1, 0, 0, 0)

      libX11.XSetSelectionOwner(display, clipboardAtom, window, 0)
      libX11.XFlush(display)

      const buffer = Buffer.from(text, "utf8")
      libX11.XChangeProperty(display, window, clipboardAtom, utf8Atom, 8, 0, buffer, buffer.length)
      libX11.XFlush(display)

      return true
    } catch (error) {
      console.log("X11 copy failed:", error)
      return false
    }
  }

  export async function read(): Promise<string | null> {
    try {
      const display = getDisplay()
      if (!display) return null

      const clipboardAtom = libX11.XInternAtom(display, "CLIPBOARD", 0)
      const utf8Atom = libX11.XInternAtom(display, "UTF8_STRING", 0)
      const textAtom = libX11.XInternAtom(display, "TEXT", 0)

      const window = libX11.XCreateSimpleWindow(display, libX11.XDefaultRootWindow(display), 0, 0, 1, 1, 0, 0, 0)

      const owner = libX11.XGetSelectionOwner(display, clipboardAtom)
      if (owner === 0) return null

      libX11.XConvertSelection(display, clipboardAtom, utf8Atom, clipboardAtom, window, 0)
      libX11.XFlush(display)

      const ref = Buffer.alloc(8)
      const actualType = Buffer.alloc(8)
      const actualFormat = Buffer.alloc(4)
      const nitems = Buffer.alloc(8)
      const bytesAfter = Buffer.alloc(8)

      const result = libX11.XGetWindowProperty(
        display,
        window,
        clipboardAtom,
        0,
        0,
        0,
        0,
        0,
        ref,
        actualType,
        actualFormat,
        nitems,
        bytesAfter,
      )

      if (result === 0) {
        const length = nitems.readUInt32LE(0)
        if (length > 0) {
          const data = Buffer.alloc(length)
          libX11.XGetWindowProperty(
            display,
            window,
            clipboardAtom,
            0,
            length,
            0,
            0,
            0,
            ref,
            actualType,
            actualFormat,
            nitems,
            bytesAfter,
          )
          return data.toString("utf8")
        }
      }

      return null
    } catch (error) {
      console.log("X11 read failed:", error)
      return null
    }
  }
}
