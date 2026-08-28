/// <reference types="@solidjs/start/env" />

import "solid-js/web"

declare module "solid-js/web" {
  interface RequestEvent {
    locals: App.RequestEventLocals
  }
}

export declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
}
