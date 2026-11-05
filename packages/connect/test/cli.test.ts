import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { ConnectStore } from "@opencode/client-core/store"
import { WorkspaceSnapshot } from "@opencode/client-core/snapshot"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { fakeConsole, signIn } from "../../client-core/test/fixture/console"

const policies = [{ action: "tool.use", resource: "shell:rm *", effect: "deny" }]
const servers: Array<{ stop: () => unknown }> = []
afterEach(() => servers.splice(0).forEach((server) => server.stop()))

// A real HTTP Console, since the connector runs as its own process the way harness hooks start it.
function serve(input: Parameters<typeof fakeConsole>[0] = {}) {
  const console = fakeConsole(input)
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => console.fetch(request) })
  servers.push(server)
  return { ...console, url: `http://127.0.0.1:${server.port}/console` }
}

async function connect(home: string, args: string[], input: { stdin?: string; env?: Record<string, string> } = {}) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), ...args], {
    env: {
      ...process.env,
      OPENCODE_API_KEY: undefined,
      OPENCODE_CONNECT_HARNESS: undefined,
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_STATE_HOME: path.join(home, "state"),
      ...input.env,
    },
    stdin: input.stdin === undefined ? "ignore" : new Blob([input.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

// The store a child process with `connect`'s environment uses.
const storeOf = (home: string) => ({
  data: path.join(home, "data", "opencode-connect"),
  cache: path.join(home, "cache", "opencode-connect"),
  state: path.join(home, "state", "opencode-connect"),
})

async function until(condition: () => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time")
    await Bun.sleep(25)
  }
}

describe("opencode-connect", () => {
  test("signs in, decides tool calls with the workspace policy, and signs out", async () => {
    await using home = await tmpdir("opencode-connect-cli-")
    const console = serve({ config: () => Response.json({ policies }) })

    const login = await connect(home.path, ["login", "--server", console.url, "--harness", "claude-cli/2.1.304"])
    expect(login.stderr).toContain("ABCD-EFGH")
    expect(login.stdout).toBe("Signed in to Acme as ada@example.com\n")
    expect(login.code).toBe(0)
    const config = console.state.requests.find((request) => request.url.endsWith("/api/v2/config"))
    expect(config?.headers.get("user-agent")).toBe("claude-cli/2.1.304 opencode-connect/2.2.5")

    const status = await connect(home.path, ["status", "--json"])
    expect(JSON.parse(status.stdout)).toMatchObject({
      signedIn: true,
      email: "ada@example.com",
      workspace: "Acme",
      policies: 1,
      routing: "keep-provider",
    })

    const blocked = await connect(home.path, ["check"], {
      stdin: JSON.stringify({ action: "shell", resources: ["echo ok && rm -rf ./probe"] }),
    })
    expect(blocked.stdout).toBe('{"effect":"deny","message":"Blocked by Acme\'s policy"}\n')
    expect(blocked.code).toBe(2)
    const allowed = await connect(home.path, ["check"], {
      stdin: JSON.stringify({ action: "shell", resources: ["echo ok"] }),
    })
    expect(allowed.stdout).toBe('{"effect":"allow"}\n')
    expect(allowed.code).toBe(0)

    expect((await connect(home.path, ["token"])).stdout).toBe("access-1\n")

    expect((await connect(home.path, ["logout"])).stdout).toBe("Signed out of OpenCode Console\n")
    expect(console.state.revoked).toEqual(["refresh-1"])
    // Signed out, the workspace's policy no longer applies.
    const signedOut = await connect(home.path, ["check"], {
      stdin: JSON.stringify({ action: "shell", resources: ["rm -rf ./probe"] }),
    })
    expect(signedOut.stdout).toBe('{"effect":"allow"}\n')
    expect((await connect(home.path, ["token"])).code).toBe(1)
  })

  test("refreshes a stale config in the background without delaying the decision", async () => {
    await using home = await tmpdir("opencode-connect-cli-")
    const console = serve({ config: () => Response.json({ policies: [] }) })
    const store = storeOf(home.path)
    ConnectStore.write(
      ConnectStore.credentialFile(store),
      JSON.stringify(signIn(console.state, Date.now() + 3_600_000, console.url)),
    )
    WorkspaceSnapshot.write(store, {
      owner: JSON.stringify([console.url, "usr_ada", "org_acme"]),
      organization: "Acme",
      fetched: Date.now() - 120_000,
      config: { policies },
    })

    const check = await connect(home.path, ["check"], {
      stdin: JSON.stringify({ action: "shell", resources: ["rm -rf ./probe"] }),
    })

    // The stale snapshot decides this call; the background sync then replaces it for the next one.
    expect(check.code).toBe(2)
    await until(() => WorkspaceSnapshot.policies(WorkspaceSnapshot.read(store)).length === 0)
    expect(console.state.configs).toBe(1)
  })

  test("fetches the workspace config before deciding when it has none for the sign-in", async () => {
    await using home = await tmpdir("opencode-connect-cli-")
    const console = serve({ config: () => Response.json({ policies }) })

    const check = await connect(home.path, ["check"], {
      stdin: JSON.stringify({ action: "shell", resources: ["rm -rf ./probe"] }),
      env: { OPENCODE_API_KEY: "oc_sk_ci", OPENCODE_CONNECT_SERVER: console.url },
    })

    expect(check.stdout).toBe('{"effect":"deny","message":"Blocked by your organization\'s policy"}\n')
    expect(check.code).toBe(2)
    expect(console.state.requests.at(-1)?.headers.get("authorization")).toBe("Bearer oc_sk_ci")
  })

  test("concurrent processes refresh an expiring sign-in once", async () => {
    await using home = await tmpdir("opencode-connect-cli-")
    const console = serve()
    const store = storeOf(home.path)
    ConnectStore.write(
      ConnectStore.credentialFile(store),
      JSON.stringify(signIn(console.state, Date.now() + 10_000, console.url)),
    )

    const tokens = await Promise.all(Array.from({ length: 4 }, () => connect(home.path, ["token"])))

    expect(tokens.map((result) => result.stdout)).toEqual(Array(4).fill("access-2\n"))
    expect(console.state.refreshes).toBe(1)
  })

  test("rejects input it can't read", async () => {
    await using home = await tmpdir("opencode-connect-cli-")
    const result = await connect(home.path, ["check"], { stdin: "rm -rf /" })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Expected JSON on stdin")
  })
})
