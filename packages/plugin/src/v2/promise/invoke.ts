import type { Registration } from "./registration.js"

export interface InvokeHooks {
  readonly register: (name: string, handle: (input: unknown) => Promise<unknown> | unknown) => Promise<Registration>
}
