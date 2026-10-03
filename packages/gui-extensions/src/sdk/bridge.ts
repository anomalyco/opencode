/**
 * Host-internal contract between the renderer host (packages/app) and the main host (packages/desktop).
 * Extensions never use this directly; they use Ipc tokens.
 * Payloads are structured-clone values already encoded with the Ipc's schemas. The `ipc` fields name an Ipc by id.
 */

/** Where an embed sits in its window, as the renderer measured it. */
export interface BridgeLayout {
  /** The embed should be on screen. */
  readonly visible: boolean
  /** Its box in window pixels; absent while it is not laid out. */
  readonly bounds?: {
    /** Left edge. */
    readonly x: number
    /** Top edge. */
    readonly y: number
    /** Width. */
    readonly width: number
    /** Height. */
    readonly height: number
  }
  /** RGBA of the backdrop the rounded corners show. */
  readonly background?: readonly [number, number, number, number]
  /** Radius of the bottom corners. */
  readonly radius?: number
}

/** An extension as the extension manager lists it. */
export interface Installed {
  /** The extension's id. */
  readonly id: string
  /** Its display name. */
  readonly name: string
  /** Its version; the app's version for built-ins. */
  readonly version: string
  /** Ships with the app. */
  readonly builtin: boolean
  /** The user has it enabled. */
  readonly enabled: boolean
  /** Changes when an installed archive is replaced or reloaded. */
  readonly revision?: string
  /** Why its main entry failed, if it did. */
  readonly error?: string
}

/**
 * A message main pushes to a window.
 * - `state`: an Ipc's new state for this window.
 * - `event`: an Ipc event.
 * - `available`: an Ipc's provider came or went.
 * - `extensions`: the installed list changed.
 * - `menubarItems`: the native menu's extension items changed.
 */
export type BridgeMessage =
  | {
      /** An Ipc's new state. */
      readonly type: "state"
      /** The Ipc's id. */
      readonly ipc: string
      /** The encoded state. */
      readonly state: unknown
    }
  | {
      /** An Ipc event. */
      readonly type: "event"
      /** The Ipc's id. */
      readonly ipc: string
      /** The event's name. */
      readonly name: string
      /** The encoded data. */
      readonly data: unknown
    }
  | {
      /** An Ipc's provider came or went. */
      readonly type: "available"
      /** The Ipc's id. */
      readonly ipc: string
      /** It is provided now. */
      readonly available: boolean
    }
  | {
      /** The installed list changed. */
      readonly type: "extensions"
      /** The new list. */
      readonly list: readonly Installed[]
    }
  | {
      /** The native menu's extension items changed. */
      readonly type: "menubarItems"
      /** The new items. */
      readonly items: readonly BridgeMenubarItem[]
    }

/** A `MenubarItem` as main publishes it to windows that draw their own menu. */
export interface BridgeMenubarItem {
  /** The menu it goes in. */
  readonly menu: string
  /** `${extension}.${id}`. */
  readonly id: string
  /** The label. */
  readonly label: string
  /** The item it follows. */
  readonly after?: string
  /** The item is enabled now. */
  readonly enabled: boolean
}

/** What the desktop preload exposes to the renderer host; undefined on the web. */
export interface Bridge {
  /** The app runs packaged, as main's `Build.packaged` says; the window's `Build` reports the same. */
  readonly packaged: boolean
  /**
   * Calls an Ipc method.
   *
   * @param input - The Ipc, the method and the encoded input.
   * @param signal - Aborts the call.
   * @returns The encoded output.
   */
  // SAFETY: the reply is the method's output as its schema encoded it; the renderer host decodes it with that schema.
  /* oxlint-disable anti-slop/no-unknown-returns -- see SAFETY above */
  call(
    input: {
      /** The Ipc's id. */
      readonly ipc: string
      /** The method's name. */
      readonly method: string
      /** The encoded input. */
      readonly input: unknown
    },
    signal?: AbortSignal,
  ): Promise<unknown>
  /* oxlint-enable anti-slop/no-unknown-returns */
  /**
   * Starts state sync for this window. Resolves with the current availability and state.
   *
   * @param ipc - The Ipc's id.
   */
  subscribe(ipc: string): Promise<{
    /** The Ipc is provided. */
    readonly available: boolean
    /** Its encoded state for this window. */
    readonly state?: unknown
  }>
  /**
   * Listens to every message main pushes.
   *
   * @param listener - Receives each message.
   * @returns Removes the listener.
   */
  on(listener: (message: BridgeMessage) => void): () => void
  /**
   * Lays out an embed, or hides it without a layout.
   *
   * @param id - The embed's id.
   * @param layout - Where it goes.
   */
  embed(id: string, layout?: BridgeLayout): void
  /**
   * A JPEG still of an embed.
   *
   * @param id - The embed's id.
   */
  capture(id: string): Promise<Uint8Array | undefined>
  /**
   * Runs a native menubar item from the in-app (Windows) menu.
   *
   * @param id - `${extension}.${id}`.
   */
  runMenubarItem(id: string): void
  /**
   * Tells main the current server endpoints so `ServerEndpoints.get(id)` can resolve them.
   *
   * @param servers - The window's servers.
   */
  configure(
    servers: readonly {
      /** The server's id. */
      readonly id: string
      /** Its base URL. */
      readonly url: string
      /** The HTTP basic user name. */
      readonly username?: string
      /** The HTTP basic password. */
      readonly password?: string
    }[],
  ): void
  /** The extension manager. */
  readonly manager: {
    /** The installed extensions, built-ins included. */
    list(): Promise<readonly Installed[]>
    /**
     * Enables an extension.
     *
     * @param id - The extension's id.
     */
    enable(id: string): Promise<void>
    /**
     * Disables an extension.
     *
     * @param id - The extension's id.
     */
    disable(id: string): Promise<void>
    /**
     * Reloads an extension's main entry; a failed reload keeps the last good revision.
     *
     * @param id - The extension's id.
     */
    reload(id: string): Promise<void>
    /**
     * Installs an archive.
     *
     * @param source - The archive's bytes, or a URL to download it from.
     */
    install(source: Uint8Array | string): Promise<void>
    /**
     * Removes an installed extension and its stored state. Built-ins refuse.
     *
     * @param id - The extension's id.
     */
    remove(id: string): Promise<void>
    /**
     * CommonJS renderer bundle of an installed extension.
     *
     * @param id - The extension's id.
     */
    source(id: string): Promise<string>
    /**
     * The URL of an installed extension's asset.
     *
     * @param id - The extension's id.
     * @param path - The asset's path in the archive.
     */
    asset(id: string, path: string): string
  }
}
