# @opencode-ai/client

Promise and Effect clients derived from OpenCode's authoritative Effect `HttpApi`, plus handwritten Node transports.

## Entrypoints

- `@opencode-ai/client`: zero-Effect Promise client using `fetch`.
- `@opencode-ai/client/node`: Promise client plus Node-hosted browser attachments.
- `@opencode-ai/client/effect`: rich Effect network client using an environment-provided `HttpClient`.

The generated surface includes every standard HTTP group from Server's concrete API. The build compiler reads `@opencode-ai/server/api`; the generated Effect runtime imports a client-local projection built from Protocol, with a generation-equivalence test preventing transport drift. Custom transports such as the PTY WebSocket connection remain outside the generic HTTP client. Run `bun run generate` after changing the contract and `bun run check:generated` to detect committed-output drift.

The Effect entrypoint uses canonical decoded values such as `Session.ID`, `Location.Ref`, and `Prompt`. These datatypes come from the lightweight `@opencode-ai/schema` package and are re-exported so callers depend only on the client surface. Protocol owns endpoint construction and middleware placement; Server supplies the concrete middleware keys used by the build-time API.

The Promise root remains structural and has no Core, Effect, Schema, Protocol, or WebSocket runtime dependency. `/node` adds Effect, Schema, Protocol, and `ws`, but never Core or Server. `/effect` depends only on Effect, Schema, and Protocol and is browser-bundle safe. Bundle-boundary tests enforce these import graphs.

## Node browser attachments

The Node entrypoint owns the control connection, Session lease, authenticated proxy, and network tunnels. Chromium hosts provide a small platform port once with `BrowserDriver.chromium`; the SDK owns command semantics, CDP input, snapshots, generations, cancellation, and limits.

```ts
import { BrowserDriver, OpenCode } from "@opencode-ai/client/node"

const driver = BrowserDriver.chromium(async ({ proxy, signal }) => {
  const view = await createChromiumView({ proxy, signal })
  return {
    resource: view,
    state: () => view.state(),
    subscribe: (listener) => view.subscribe((state, mainDocumentChanged) => listener({ state, mainDocumentChanged })),
    navigate: (url) => view.navigate(url),
    back: () => view.back(),
    forward: () => view.forward(),
    reload: () => view.reload(),
    stop: () => view.stop(),
    send: (method, params) => view.sendCDP(method, params),
    viewport: () => view.viewport(),
    screenshot: ({ maxDimension }) => view.capturePNG({ maxDimension }),
    dispose: () => view.close(),
  }
})

const client = OpenCode.make({
  baseUrl: "https://opencode.example",
  headers: { authorization: `Basic ${credentials}` },
})
const registration = await client.browser.register({
  sessionID,
  open: () => showBrowserPane(),
})
const attachment = await registration.attach({ driver })

await attachment.resource.navigate("example.com")
const view = attachment.resource.resource
await attachment.close()
await registration.close()
```

`register` owns one control WebSocket for one Session. Its `open` callback is invoked when the server requests the browser pane. `attach` resolves only after the server acknowledges the exact lease; closing an attachment leaves its registration connected for a later `open`, while closing the registration closes the socket.

Driver factories should return after configuring their resource rather than await a proxied navigation: tunnel dialing is deliberately held behind the first lease acknowledgement, which is published after the driver supplies its initial state.

Port state events set `mainDocumentChanged` only when the main document changes; this advances the public generation and invalidates element refs. `send` must dispatch CDP calls in invocation order. `screenshot` returns PNG bytes and dimensions, proportionally scaled to `maxDimension` without upscaling. The returned controller serializes local navigation with remote commands; `stop` immediately interrupts active work, and controller disposal is idempotent. An aborted or timed-out operation that reached the platform disposes the port so late native completion cannot cross the queue fence.

`BrowserDriver` descriptors are structural factory functions, so adapters remain compatible across duplicate client package instances. The Node entrypoint also re-exports canonical `Browser` contracts. `BrowserDriver.define` remains the advanced escape hatch for non-Chromium semantics; throw `BrowserDriverError` for typed command failures there. Structurally equivalent errors are accepted only when their `code` is a valid `Browser.ErrorCode`.

Effect consumers construct canonical decoded inputs:

```ts
import { AbsolutePath, Location, OpenCode, Prompt } from "@opencode-ai/client/effect"

const client = yield * OpenCode.make({ baseUrl: "https://opencode.example" })
yield *
  client.sessions.create({
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
  })
yield * client.sessions.prompt({ sessionID, prompt: Prompt.make({ text: "Hello" }) })
```
