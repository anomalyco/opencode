import type { Browser } from "@opencode-ai/schema/browser"
import { chromiumDriver, type ChromiumDriver, type ChromiumPort } from "./chromium.js"
export interface BrowserProxy {
  readonly url: string
  readonly host: string
  readonly port: number
  readonly credentials: {
    readonly username: string
    readonly password: string
  }
}
export interface BrowserDriverContext {
  readonly proxy: BrowserProxy
  readonly signal: AbortSignal
}
export interface BrowserDriverInstance<Resource> {
  readonly resource: Resource
  readonly state: () => Browser.State
  readonly subscribe: (listener: (state: Browser.State) => void) => () => void
  readonly execute: (command: Browser.Command, options: { readonly signal: AbortSignal }) => Promise<Browser.Result>
  readonly dispose: () => Promise<void> | void
}
export type BrowserDriverFactory<Resource> = (
  context: BrowserDriverContext,
) => Promise<BrowserDriverInstance<Resource>> | BrowserDriverInstance<Resource>
export class BrowserDriverError extends Error {
  override readonly name = "BrowserDriverError"

  constructor(
    readonly code: Browser.ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export type BrowserDriver<Resource> = BrowserDriverFactory<Resource>

export const BrowserDriver = {
  define<Resource>(create: BrowserDriverFactory<Resource>): BrowserDriver<Resource> {
    return create
  },
  chromium<Resource>(
    create: (context: BrowserDriverContext) => PromiseLike<ChromiumPort<Resource>> | ChromiumPort<Resource>,
  ): ChromiumDriver<Resource> {
    return chromiumDriver(create)
  },
}

export function browserDriverFactory<Resource>(driver: BrowserDriver<Resource>) {
  return driver
}
