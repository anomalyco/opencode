# Passkeys in the in-app browser — decision record

Date: 2026-11-17 · Branch: `passkey-handoff` · Status: proposed

## Question

GitHub sudo mode (`https://github.com/settings/tokens` → _Generate new token (classic)_ → _Use passkey_)
and Cloudflare SSO (`https://dash.cloudflare.com` → Google sign-in → passkey/security-key step) cannot
complete in the desktop app's in-app browser. Can first-class passkey/WebAuthn support be added to the
pane, or should the credential step be handed off to the system browser?

## Finding: passkeys cannot work in the pane

The in-app browser is a local, sandboxed `electron.WebContentsView`
(`packages/gui-plugins/src/browser/chromium.ts`), not a remote browser. Chromium and page JavaScript run
on the user's machine; only network traffic is relayed through the connected server. The page sees its
real origin. Measured on the live pane (OpenCode 2.3.0, Electron 44.9.1 / Chromium 152) against
`https://example.com`:

- `location.origin` is the real origin and `isSecureContext` is `true`.
- `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves `false`.
- `getClientCapabilities()` reports `passkeyPlatformAuthenticator: true` but
  `userVerifyingPlatformAuthenticator: false`.

So WebAuthn requests reach a real, secure context; the platform authenticator is what is missing, for
stacked reasons:

1. **`app.configureWebAuthn()` is never called.** Electron services no platform-authenticator request
   until the app opts in.
2. **Electron's Touch ID path creates new, app-scoped credentials.**
   `configureWebAuthn({ touchID: { keychainAccessGroup } })` plus a `keychain-access-groups` entitlement
   enables a Touch ID authenticator bound to this app's keychain. It cannot use the passkey that already
   lives in the user's iCloud Keychain, so GitHub's and Google's existing passkeys still fail. Only
   credentials OpenCode itself created would work — and they would live in an ephemeral partition
   (reason 4).
3. **Apple's generic passkey path needs entitlements OpenCode cannot hold.** `platformPasskeys` requires
   `webcredentials:<rpId>` associated domains and an AASA file listing OpenCode's Team ID; GitHub and
   Google will not publish one. Using any existing passkey for any relying party requires Apple's managed
   `com.apple.developer.web-browser.public-key-credential` entitlement, which Apple grants to actual web
   browsers, not embedded Chromium views, and which Electron does not implement.
   `codesign -d --entitlements :- /Applications/OpenCode.app` shows the shipping app holds only
   `com.apple.security.cs.allow-jit` and `com.apple.security.device.audio-input`.
4. **The browser partition is ephemeral.** Each attachment creates
   `opencode-browser-${crypto.randomUUID()}` (`packages/gui-plugins/src/browser/pane.ts`); credentials
   created in it die with the attachment.

References: Electron's `app.configureWebAuthn()` and the `select-webauthn-account` session event
(electronjs.org/docs/latest/api/app, electronjs.org/docs/latest/api/session), and Apple's entitlement
documentation for `com.apple.developer.web-browser.public-key-credential`.

## Decision

**Hand the credential step to the system browser** — `browser.handoff({ tabID })` — with one documented
deviation from the original option B: **the pane does not inherit the authenticated session.**

Returning the session would mean copying the system browser's cookies or credentials into the pane,
which is exactly the credential transfer this feature must not perform. Instead:

- The pane shows a banner first — the page's URL, "Sign in to {host} in your system browser", with **Open** and
  **Cancel**. Nothing opens on the agent's word alone: the desktop launches the user's default browser
  (`shell.openExternal`) only on the user's **Open** click.
- The banner then waits — "Finish signing in to {host}" — with **Done** and **Cancel**.
- The tool waits for that answer (ten minutes in the desktop, a twelve-minute server backstop) and resolves
  `{ state: "completed" | "cancelled" | "timedOut", host }`. A launch the user started that fails rejects with a
  plain error instead.
- The pane stays signed out by design. Work that needs the sign-in stays with the user in the system
  browser.

This is the smallest honest alternative: it unblocks both reproductions without weakening a single
check.

## Rejected alternatives

- **Passkeys in the pane (option A):** fails both acceptance checks for the reasons above. Touch ID
  would create credentials the user's relying parties have never seen, in a partition that dies with the
  attachment. Claiming passkey support would be misleading.
- **Inheriting the external session (cookie copy):** forbidden credential transfer, and it would break
  the pane's per-partition isolation.
- **Proxy trust, CA installation, or RP-ID/origin weakening:** out of scope by requirement; each would
  weaken security for every site, not just sign-in.

## Invariants

- Handoffs open only `http:`/`https:` URLs without embedded credentials (`destinationOrigin` in
  `packages/gui-plugins/src/browser/policy.ts`).
- The system browser opens only on the user's **Open** click in the Review pane, never on the agent's request
  alone. The banner shows the page's URL while asking — the same URL the pane's address bar already shows.
- No URL, cookie, token, password, one-time code, page content, or other credential material appears in tool
  inputs, tool results, or errors. Events carry `{ type, tabID, id, host, state }` plus that asking URL; results
  carry `{ state, host }`.
- The URL is passed once to `shell.openExternal` and dropped; launch errors never echo it.
- The pane never claims to be authenticated after a handoff.
- The tool contract is additive: one new `handoff` action; every existing operation is unchanged.

## Tests

- `packages/gui-plugins/src/browser/handoff.test.ts`: the manager opens the URL exactly once, emits
  `pending` then the outcome, settles Done/Cancel/timeout/abort, refuses non-web and credential-bearing
  URLs and a second concurrent handoff, and its results and events carry only the allowed keys.
- `packages/plugin-browser/test/rpc.test.ts`: the operation's output decodes only `{ state, host }` with
  a terminal state, and the operation is discoverable by the phrases an agent searches for.
- `packages/app/component-tests/browser-pane.spec.ts`: the banner appears for a waiting handoff, answers
  through the real model, and reports the outcome.

## Manual acceptance checks

1. `https://github.com/settings/tokens` → _Generate new token (classic)_ → sudo mode → _Use passkey_: the
   passkey step cannot complete in the pane; `browser.handoff` opens the page in the system browser, the
   user completes sudo there, and the pane reports the outcome while staying signed out.
2. `https://dash.cloudflare.com` → Google SSO → passkey/security-key step: the same flow.
