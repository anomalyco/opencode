// Pure-JS X11 clipboard owner (ICCCM selections), no external binaries.
//
// Works on native X11 sessions and on Wayland sessions via XWayland, where the
// compositor (e.g. mutter on GNOME) continuously bridges the X11 CLIPBOARD
// selection to the Wayland clipboard — including persisting the content after
// this process exits.
//
// Like codex's `ClipboardLease`, the connection and owner window are kept
// alive for the lifetime of the TUI so paste requests can be served. Reuse a
// single instance across copies.

import x11 from "x11"
import type { X11Client, X11Display, X11Event } from "x11"

const CHUNK = 100_000 // bytes per ChangeProperty request (replace, then append)

function createClient(): Promise<{ client: X11Client; display: X11Display }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out connecting to the X server")), 3000)
    x11.createClient((err, display) => {
      clearTimeout(timeout)
      if (err) return reject(err)
      resolve({ client: display.client, display })
    })
  })
}

export class X11Clipboard {
  private constructor(
    private client: X11Client,
    private win: number,
    private atoms: Record<"clipboard" | "targets" | "utf8" | "string" | "text" | "timestamp" | "property", number>,
    private data: Buffer = Buffer.alloc(0),
  ) {
    client.on("event", (ev) => this.onEvent(ev))
  }

  static async create(): Promise<X11Clipboard> {
    const { client, display } = await createClient()
    const win = client.AllocID()
    client.CreateWindow(win, display.screen[0].root, 0, 0, 1, 1)
    const intern = (name: string) =>
      new Promise<number>((resolve, reject) =>
        client.InternAtom(false, name, (err, atom) => (err ? reject(err) : resolve(atom))),
      )
    const [clipboard, targets, utf8, string, text, timestamp, property] = await Promise.all(
      ["CLIPBOARD", "TARGETS", "UTF8_STRING", "STRING", "TEXT", "TIMESTAMP", "OPENCODE_CLIPBOARD_DATA"].map(intern),
    )
    return new X11Clipboard(client, win, { clipboard, targets, utf8, string, text, timestamp, property })
  }

  /** Take ownership of CLIPBOARD and serve `text` to paste requests. */
  setText(text: string) {
    this.data = Buffer.from(text, "utf8")
    this.client.SetSelectionOwner(this.win, this.atoms.clipboard, 0)
  }

  /** Request the current CLIPBOARD content from its owner. */
  readText(): Promise<string | undefined> {
    const { client, atoms, win } = this
    return new Promise((resolve) => {
      const finish = (text: string | undefined) => {
        clearTimeout(timeout)
        client.removeListener("event", listener)
        resolve(text)
      }
      const timeout = setTimeout(() => finish(undefined), 3000)
      const listener = (ev: X11Event) => {
        if (ev.name !== "SelectionNotify" || ev.selection !== atoms.clipboard) return
        if (!ev.property) return finish(undefined)
        client.GetProperty(true, win, atoms.property, 0, 0, 1 << 24, (err, prop) => {
          finish(err ? undefined : prop.data.toString("utf8"))
        })
      }
      client.on("event", listener)
      client.DeleteProperty(win, atoms.property)
      client.ConvertSelection(win, atoms.clipboard, atoms.utf8, atoms.property, 0)
    })
  }

  close() {
    this.client.terminate()
  }

  private onEvent(ev: X11Event) {
    if (ev.name === "SelectionRequest" && ev.selection === this.atoms.clipboard) {
      this.serve(ev)
    }
  }

  private serve(ev: X11Event) {
    const { client, atoms } = this
    // ICCCM: a None property means "use the target atom as the property"
    let property = ev.property || ev.target
    try {
      if (ev.target === atoms.targets) {
        const list = Buffer.alloc(16)
        ;[atoms.targets, atoms.utf8, atoms.string, atoms.timestamp].forEach((a, i) => list.writeUInt32LE(a, i * 4))
        client.ChangeProperty(0, ev.requestor, property, 4 /* ATOM */, 32, list)
      } else if (ev.target === atoms.timestamp) {
        const time = Buffer.alloc(4)
        time.writeUInt32LE(ev.time >>> 0, 0)
        client.ChangeProperty(0, ev.requestor, property, ev.target, 32, time)
      } else if (ev.target === atoms.utf8 || ev.target === atoms.string || ev.target === atoms.text) {
        client.ChangeProperty(0, ev.requestor, property, ev.target, 8, this.data.subarray(0, CHUNK))
        for (let offset = CHUNK; offset < this.data.length; offset += CHUNK) {
          client.ChangeProperty(1, ev.requestor, property, ev.target, 8, this.data.subarray(offset, offset + CHUNK))
        }
      } else {
        property = 0 // refuse unsupported target
      }
    } catch {
      property = 0
    }
    client.SendEvent(ev.requestor, false, 0, {
      name: "SelectionNotify",
      time: ev.time,
      requestor: ev.requestor,
      selection: ev.selection,
      target: ev.target,
      property,
    })
  }
}
