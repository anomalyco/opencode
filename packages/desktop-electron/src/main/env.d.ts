interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare module "virtual:opencode-server" {
  export namespace Server {
    export const listen: typeof import("../../../opencode/dist/types/src/node").Server.listen
    export type Listener = import("../../../opencode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../opencode/dist/types/src/node").Config.get
    export type Info = import("../../../opencode/dist/types/src/node").Config.Info
  }
  export namespace Log {
    export const init: typeof import("../../../opencode/dist/types/src/node").Log.init
  }
  export namespace Database {
    export const Path: typeof import("../../../opencode/dist/types/src/node").Database.Path
    export const Client: typeof import("../../../opencode/dist/types/src/node").Database.Client
  }
  export namespace JsonMigration {
    export type Progress = import("../../../opencode/dist/types/src/node").JsonMigration.Progress
    export const run: typeof import("../../../opencode/dist/types/src/node").JsonMigration.run
  }
  export const bootstrap: typeof import("../../../opencode/dist/types/src/node").bootstrap
}
