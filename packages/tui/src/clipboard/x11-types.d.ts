declare module "x11" {
  export interface X11Event {
    name: string
    time: number
    owner: number
    requestor: number
    selection: number
    target: number
    property: number
  }

  export interface X11Client {
    AllocID(): number
    CreateWindow(wid: number, parent: number, x: number, y: number, w: number, h: number): void
    InternAtom(onlyIfExists: boolean, name: string, cb: (err: Error | null, atom: number) => void): void
    SetSelectionOwner(owner: number, selection: number, time: number): void
    ConvertSelection(requestor: number, selection: number, target: number, property: number, time: number): void
    ChangeProperty(mode: 0 | 1 | 2, wid: number, name: number, type: number, format: 8 | 16 | 32, data: Buffer): void
    DeleteProperty(wid: number, property: number): void
    GetProperty(
      del: boolean,
      wid: number,
      name: number,
      type: number,
      longOffset: number,
      longLength: number,
      cb: (err: Error | null, prop: { type: number; data: Buffer }) => void,
    ): void
    SendEvent(destination: number, propagate: boolean, eventMask: number, event: Record<string, unknown>): void
    on(event: "event", cb: (ev: X11Event) => void): void
    removeListener(event: "event", cb: (ev: X11Event) => void): void
    terminate(): void
  }

  export interface X11Display {
    client: X11Client
    screen: { root: number }[]
  }

  const x11: {
    createClient(cb: (err: Error | null, display: X11Display) => void): void
  }
  export default x11
}
