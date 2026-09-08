import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider } from "../../src/runtime/platform/platform"
import { createWebPlatform } from "../../src/runtime/platform/web"
import { ServerConnection } from "../../src/runtime/server/registry"
import { createMemoryHistory, MemoryRouter } from "@solidjs/router"
import { render } from "solid-js/web"
import { Schema } from "effect"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"

const web = createWebPlatform("test")
const history = createMemoryHistory()
history.set({ value: "/settings" })
const inventory = Schema.Array(ExtensionManager.Installed)
async function request(name: string, body?: BodyInit) {
  const response = await fetch(`/__desktop-extensions/${name}`, { method: body ? "POST" : "GET", body })
  const value: unknown = await response.json()
  if (!response.ok)
    throw new ExtensionManager.ManagerError(Schema.decodeUnknownSync(ExtensionManager.Failure)(value).code)
  return value
}
const manager: ExtensionManager.Transport = {
  list: async () => Schema.decodeUnknownSync(inventory)(await request("list")),
  install: async (data) =>
    Schema.decodeUnknownSync(inventory)(await request("install", data as Uint8Array<ArrayBuffer>)),
  installURL: async (url) => Schema.decodeUnknownSync(inventory)(await request("url", JSON.stringify({ url }))),
  enable: async (id, enabled) =>
    Schema.decodeUnknownSync(inventory)(await request("enable", JSON.stringify({ id, enabled }))),
  reload: async (id) => Schema.decodeUnknownSync(inventory)(await request("reload", JSON.stringify({ id }))),
  source: async (id, revision) =>
    Schema.decodeUnknownSync(ExtensionManager.Source)(await request("source", JSON.stringify({ id, revision }))),
  assetURL: (id, revision, path) => `/__desktop-extensions/assets/${id}/${revision}/${path}`,
  onChange(callback) {
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) callback(Schema.decodeUnknownSync(inventory)(event.detail))
    }
    window.addEventListener("test-extensions-changed", listener)
    return () => window.removeEventListener("test-extensions-changed", listener)
  },
}
render(
  () => (
    <PlatformProvider value={{ ...web.platform, extensionManager: manager }}>
      <AppBaseProviders>
        <AppInterface
          servers={[{ type: "http", http: { url: web.currentServerUrl! } }]}
          defaultServer={ServerConnection.Key.make(web.currentServerUrl!)}
          router={(props) => <MemoryRouter {...props} history={history} />}
        />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
