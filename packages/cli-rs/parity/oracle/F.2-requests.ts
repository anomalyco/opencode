// P-ORACLE for F.2: records the requests the TypeScript Promise client builds, for
// crates/api/tests/oracle.rs to compare with the generated Rust client. Writes parity/fixtures/F.2/requests.json.
// The raw generated client: the exported `OpenCode.make` wraps it (one shared event subscription without
// input), and the Rust generated client corresponds to the raw one. The package exports do not expose it.
import { make } from "../../../client/src/promise/generated/client.ts"

type Recorded = {
  name: string
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  bodyBase64?: string
}

const recorded: Array<Recorded> = []
let current = ""
const client = make({
  baseUrl: "http://127.0.0.1:4096/prefix",
  headers: { authorization: "Basic b3BlbmNvZGU6c2VjcmV0" },
  fetch: Object.assign(
    async (url: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = Object.fromEntries(new Headers(init.headers))
      const body = init.body
      recorded.push({
        name: current,
        method: init.method ?? "GET",
        url: String(url),
        headers,
        ...(typeof body === "string" ? { body } : {}),
        ...(body instanceof Uint8Array ? { bodyBase64: Buffer.from(body).toString("base64") } : {}),
      })
      throw new Error("recorded")
    },
    { preconnect: fetch.preconnect },
  ),
})

const call = async (name: string, run: () => Promise<unknown> | AsyncIterable<unknown>) => {
  current = name
  const result = run()
  try {
    if (Symbol.asyncIterator in result) for await (const _ of result) break
    else await result
  } catch {}
}

// Typed calls; crates/api/tests/oracle.rs makes the same calls with the same values.
await call("config.get", () => client.config.get({ location: { directory: "/tmp/a b&c=d" } }))
await call("session.list", () =>
  client.session.list({ limit: 5, order: "desc", search: "héllo wörld+?", parentID: null, archived: false }),
)
await call("session.get", () =>
  client.session.get({ sessionID: "ses_1 /?#%" }, { headers: { "X-Opencode-Directory": "/override" } }),
)
await call("file.read", () => client.file.read({ path: "dir/a b/c#?.txt", location: { directory: "/w" } }))
await call("session.prompt", () =>
  client.session.prompt({ sessionID: "ses_1", text: "hi", resume: null, metadata: { k: 1 } }),
)
await call("experimental.file.write", () =>
  client.experimental.file.write({ path: "a.txt", payload: new Uint8Array([1, 2, 255]) }),
)
await call("event.subscribe", () => client.event.subscribe({ types: ["session.created", "rpc.x"] }))
await call("session.remove", () => client.session.remove({ sessionID: "ses_2" }))
// Numbers the schema leaves as plain numbers: whole values go out as `0` and `3`, fractions as they are.
await call("session.prompt numbers", () =>
  client.session.prompt({
    sessionID: "ses_1",
    text: "@build x",
    agents: [
      { name: "build", mention: { start: 0, end: 6, text: "@build" } },
      { name: "plan", mention: { start: 1.5, end: -0, text: "@plan" } },
    ],
  }),
)
await call("session.form.reply numbers", () =>
  client.session.form.reply({
    sessionID: "ses_1",
    formID: "frm_1",
    answer: { count: 3, ratio: 2.5, big: 123456789012, tiny: 0.25, name: "x" },
  }),
)

const requests = recorded.slice()

// appendQuery over values the types do not limit; the Rust side feeds them to query::append.
const values: Array<unknown> = [
  { directory: "a" },
  { a: { b: { c: "d" } } },
  ["x", "y"],
  null,
  1,
  1.5,
  1e21,
  1e-7,
  0.000001,
  -0,
  123456789012,
  true,
  false,
  "ü ✓ & = + % # / ? ~*'()!",
  { list: [1, { x: 2 }], empty: [] },
  "",
]
const query = values.map((value) => {
  recorded.length = 0
  void client.config.get({ location: value } as never).catch(() => {})
  return { value, search: new URL(recorded[0].url).search.slice(1) }
})

await Bun.write(
  new URL("../fixtures/F.2/requests.json", import.meta.url),
  JSON.stringify({ requests, query }, null, 2) + "\n",
)
