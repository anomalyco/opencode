# Vercel AI Gateway setup

The Vercel integration offers a native setup wizard alongside manual API-key entry. The wizard uses Vercel device authorization, lists the teams the user can access, asks for a key name and optional expiration, and previews the key before creating it. Only the resulting AI Gateway key is saved in OpenCode's credential store. The Vercel sign-in access token is kept in memory for the interview and is not persisted.

Budget configuration is not part of the required interview. After connecting, users can continue immediately or open **Set a spending limit (optional)**. This opens the selected team's AI Gateway API-key settings, where they can manage the newly named key.

## App registration

For now the wizard defaults to Vercel CLI's public client ID, `cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp`, copied from the linked CLI source at the user's request. No client secret is used. The Vercel consent screen will identify the application as Vercel CLI.

To switch to an OpenCode-owned app later, set `OPENCODE_VERCEL_CLIENT_ID` in the **OpenCode server's environment**. That app must support the device authorization grant as a public client, without a client secret.

Configure the app with **Team: Read Only** and **AI Gateway API Keys: Read and Write** permissions. Vercel currently documents API permissions as a private beta; confirm that the OpenCode app is eligible for these permissions and the device authorization grant before enabling this in a release. Budget write access is unnecessary because budget management opens Vercel's dashboard.

References:

- [Vercel CLI OAuth implementation](https://github.com/vercel/vercel/blob/main/packages/cli/src/util/oauth.ts)
- [Vercel scopes and permissions](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions)
- [Vercel CLI AI Gateway setup](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/ai-gateway/coding-agents-setup.ts)

## Renewal

New keys save their expiration, name, and expiration preset alongside the team and key ID. The provider watches the next expiration and reports **Key expired** on the existing connection. A Gateway `401` also offers reconnect, covering revoked keys and older saved keys without expiry metadata; billing (`402`) and permission (`403`) failures do not start renewal.

In the app, open the Vercel connection and select **Replace key**. The TUI exposes the same action on the affected account. CLI `auth login vercel` with the Gateway setup method renews the affected connection, asking which one if several need attention. Browser authorization is followed by the existing setup interview, prefilled with the previous team, key name, and expiration when available.

Only successful, confirmed authorization replaces the saved credential. The connection's ID, label, active-account selection, and model preferences are preserved; cancellation or failed authorization leaves the old key untouched. Renewal does not retain Vercel OAuth tokens or create replacement keys silently in the background. Old remote keys are not deleted automatically.

## Shared integration behavior

OAuth authorizers may use their second `prompt` argument to ask validated forms after sign-in. Each form has an ID, appears in the pending attempt's status, and is answered through `integration.oauth.complete` with `promptID` and `answer`. Replayed or stale form IDs are rejected. Existing code and automatic OAuth methods remain supported.

Authorization callbacks may return an OAuth credential or a derived API-key credential. An optional `onComplete` produces a public next-step link only after credential persistence succeeds. TUI, CLI, and app clients support these prompts and next-step links. Cancelling or expiring an interview interrupts the pending callback; no key is created before the user confirms the review.

## Verification

From `packages/core`:

```sh
bun run script/test.ts test/integration.test.ts test/plugin/provider-vercel-gateway.test.ts test/plugin/provider-vercel.test.ts
```

These tests exercise a local HTTP server, the real integration state machine, validation, cancellation, denied authorization, the key-creation payload, credential persistence, and the optional budget link. They do not authenticate to Vercel or create real keys. Live verification requires completing browser authorization.
