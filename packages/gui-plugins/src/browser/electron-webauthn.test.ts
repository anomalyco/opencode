import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"
import { PASSKEY_REFUSAL } from "./webauthn-gate"

// Electron draws no WebAuthn request UI, and on Windows Chromium hands requests to the system's dialog. This runs the
// WebAuthn gate (webauthn-gate.ts) in the pinned Electron. Where the pane refuses, the browser process refuses too: the
// tab answers from CDP's empty virtual authenticator environment, which a virtual authenticator proves by receiving
// the one credential a step creates, so a request that gets around the page-side wrapper never reaches the system.
// The wrapper refuses explicit requests at once, also against options built to slip past it, leaves no trace on the
// page, keeps autofill waiting silently, and lets a password manager's own wrapper answer first. The fixture checks
// that the environment covers each page before any request there, and stops otherwise.
test(
  "the pinned Electron refuses a page's passkey requests in the browser process and at once on the page",
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

      expect(result.stopped).toBeUndefined()
      // The browser process: a request reaches only the virtual environment, and fails there without an authenticator.
      expect(result).toMatchObject({ bareCovered: true, routedCreate: "credential", routedCredentials: 1, bareGet: "NotAllowedError" })
      // A Windows tab the agent drives: every shape of request is refused, by the wrapper or by the environment.
      expect(result.agentCovered).toBe(true)
      expect(result.functionOptions).toBe("NotAllowedError")
      expect(result.inheritedOptions).toBe("NotAllowedError")
      // The getter's first answer is the one Chromium gets: a request without `publicKey`, so no passkey is asked for.
      expect(result.twoFacedGetter).not.toBe("credential")
      expect(result.frameRealm).toBe("NotAllowedError")
      expect(result.addedGlobals).toEqual([])
      expect(result.nativeLooking).toEqual([true, true, true])
      // A pop-up enforced while Electron creates it is covered before its opener's script runs again.
      expect(result.popupUVPAA).toBe(false)
      // macOS and Linux: pages hear that no passkey path is available, and explicit requests fail at once.
      expect(result.capabilities.slice(0, 2)).toEqual([false, false])
      expect(result.capabilities[2]).toMatchObject({
        conditionalGet: false,
        conditionalCreate: false,
        immediateGet: false,
        hybridTransport: false,
        passkeyPlatformAuthenticator: false,
        userVerifyingPlatformAuthenticator: false,
      })
      expect([result.macGet, result.macCreate]).toEqual(["NotAllowedError", "NotAllowedError"])
      expect(result.afterExplicit).toBe(2)
      // Autofill, immediate and aborted requests end without a refusal, so the pane shows no notice for them.
      expect(result.conditional).toEqual({ before: "pending", after: "AbortError" })
      expect(result.immediate).toBe("NotAllowedError")
      expect(result.preAborted).toBe("AbortError")
      // The conditional case's own explicit request is the one refusal it adds.
      expect(result.afterConditional).toBe(3)
      // The password manager answered its own passkey; the request it handed on was refused.
      expect(result.manager).toEqual(["from-manager", "NotAllowedError"])
      expect(result.refusals).toBe(4)
      // Another site's frame, in a process of its own, answers from the environment: no platform authenticator, then
      // the virtual one, then none; so after the page went to another site, and after its renderer crashed.
      expect(result.frameOutOfProcess).toEqual([true, false, true, false])
      expect(result.frameAfterNavigation).toEqual([true, false, true, false])
      expect(result.frameAfterCrash).toEqual([true, false, true, false])
      expect(result.pageAfterCrash).toBe(false)
      expect(PASSKEY_REFUSAL).toContain("not supported in this browser")
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner, and the environment's refusals wait for their 1 s timeouts.
  60_000,
)
