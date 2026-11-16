import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"
import { PASSKEY_REFUSAL } from "./webauthn-gate"

// Electron draws no WebAuthn request UI, so where the system shows none either a page's passkey request hangs until its
// timeout. This runs the WebAuthn gate (webauthn-gate.ts) in the pinned Electron: explicit requests fail at once with
// NotAllowedError, autofill requests wait silently, pages hear that no passkey path is available, and a password
// manager's own wrapper still answers first. The gate refuses every request in the page, so nothing reaches Chromium's
// WebAuthn stack and no system dialog can open.
test(
  "the pinned Electron refuses a page's passkey requests at once and reports no passkey support",
  async () => {
    const out = await mkdtemp(path.join(tmpdir(), "electron-webauthn-"))

    try {
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "electron-webauthn.fixture.ts")],
        outdir: out,
        target: "node",
        format: "cjs",
        external: ["electron"],
      })

      if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

      const child = Bun.spawn(
        [
          String(electron),
          // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
          ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
          path.join(out, "electron-webauthn.fixture.js"),
        ],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined }, stdout: "pipe", stderr: "pipe" },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (!line) throw new Error(`Electron printed no result (exit ${code}).\n${stderr}`)

      const result = JSON.parse(line)

      expect(result.capabilities.slice(0, 2)).toEqual([false, false])
      expect(result.capabilities[2]).toMatchObject({
        conditionalGet: false,
        conditionalCreate: false,
        immediateGet: false,
        hybridTransport: false,
        passkeyPlatformAuthenticator: false,
        userVerifyingPlatformAuthenticator: false,
      })
      // Explicit requests fail with what a browser says when no authenticator is available, well within a second.
      expect(result.get).toMatchObject({ name: "NotAllowedError", message: PASSKEY_REFUSAL })
      expect(result.made).toMatchObject({ name: "NotAllowedError", message: PASSKEY_REFUSAL })
      expect(result.get.ms).toBeLessThan(1_000)
      expect(result.made.ms).toBeLessThan(1_000)
      expect(result.afterExplicit).toBe(2)
      // Autofill, immediate and aborted requests end without a refusal, so the pane shows no notice for them.
      expect(result.conditional).toEqual({ before: "pending", after: "AbortError" })
      expect(result.immediate).toBe("NotAllowedError")
      expect(result.preAborted).toBe("AbortError")
      expect(result.afterConditional).toBe(2)
      // The password manager answered its own passkey; the request it handed on was refused.
      expect(result.manager).toEqual(["from-manager", "NotAllowedError"])
      expect(result.refusals).toBe(3)
      // Where the system answers requests, autofill still reports unavailable; the rest is Chromium's own answer.
      expect(result.nativeCapabilities[1]).toBe(false)
      expect(result.nativeCapabilities[2]).toMatchObject({ conditionalGet: false, conditionalCreate: false })
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
