import {
  Browser,
  BrowserDriver,
  BrowserDriverError,
  OpenCode,
  type BrowserAttachment,
  type BrowserRegistration,
} from "@opencode-ai/client/node"

const state: Browser.State = {
  url: "about:blank",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 0,
}

const driver = BrowserDriver.define<{ readonly proxyURL: string }>((context) => ({
  resource: { proxyURL: context.proxy.url },
  state: () => state,
  subscribe: () => () => undefined,
  execute: async (_command, options) => {
    throw new BrowserDriverError(options.signal.aborted ? "aborted" : "internal", "Command unavailable")
  },
  dispose: () => undefined,
}))

declare const client: ReturnType<typeof OpenCode.make>
const registration: Promise<BrowserRegistration> = client.browser.register({
  sessionID: "ses_type_fixture",
  open: () => undefined,
})
void registration.then((handle) => {
  const attachment: Promise<BrowserAttachment<{ readonly proxyURL: string }>> = handle.attach({ driver })
  void attachment
})
