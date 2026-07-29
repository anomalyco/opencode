import {
  Browser,
  BrowserDriver,
  BrowserDriverError,
  OpenCode,
  type BrowserAttachment,
  type BrowserRegistration,
  type ChromiumController,
  type ChromiumDriver,
  type ChromiumPort,
} from "@opencode-ai/client/node"

const state: Browser.State = {
  url: "about:blank",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
}

const factory: BrowserDriver<{ readonly proxyURL: string }> = (context) => ({
  resource: { proxyURL: context.proxy.url },
  state: () => state,
  subscribe: () => () => undefined,
  execute: async (_command, options) => {
    throw new BrowserDriverError(options.signal.aborted ? "aborted" : "internal", "Command unavailable")
  },
  dispose: () => undefined,
})
const driver = BrowserDriver.define(factory)
declare const port: ChromiumPort<{ readonly page: true }>
const chromium: ChromiumDriver<{ readonly page: true }> = BrowserDriver.chromium(() => port)

declare const client: ReturnType<typeof OpenCode.make>
const registration: Promise<BrowserRegistration> = client.browser.register({
  sessionID: "ses_type_fixture",
  open: () => undefined,
})
void registration.then((handle) => {
  const attachment: Promise<BrowserAttachment<{ readonly proxyURL: string }>> = handle.attach({ driver })
  const chromiumAttachment: Promise<BrowserAttachment<ChromiumController<{ readonly page: true }>>> = handle.attach({
    driver: chromium,
  })
  void attachment
  void chromiumAttachment
})
