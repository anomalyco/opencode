interface ImportMetaEnv {
  readonly PENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:pencode-server" {
  export namespace Server {
    export const listen: typeof import("../../../pencode/dist/types/src/node").Server.listen
    export type Listener = import("../../../pencode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../pencode/dist/types/src/node").Config.get
    export type Info = import("../../../pencode/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../pencode/dist/types/src/node").bootstrap
}
