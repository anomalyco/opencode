# SolidStart

Everything you need to build a Solid project, powered by [`solid-start`](https://start.solidjs.com);

## Creating a project

```bash
# create a new project in the current directory
npm init solid@latest

# create a new project in my-app
npm init solid@latest my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

Solid apps are built with _presets_, which optimise your project for deployment to different environments.

By default, `npm run build` will generate a Node app that you can run with `npm start`. To use a different preset, add it to the `devDependencies` in `package.json` and specify in your `app.config.js`.

## This project was created with the [Solid CLI](https://github.com/solidjs-community/solid-cli)

## TODO: Inference Service Gateway Wiring

The console still executes provider requests directly in
`src/routes/zen/util/handler.ts`. When that path is replaced with an internal
request to the inference service, the console must set proxy-owned headers
explicitly instead of forwarding the public request header bag unchanged.

Request-header wiring still to implement in the console:

| Internal header | Console source | Required behavior |
| --- | --- | --- |
| `x-opencode-caller-id` | Authenticated `authInfo.apiKeyId` | Set this for authenticated traffic so caller request limiting preserves the legacy per-key boundary without sending the secret Zen API key. The value must be a stable opaque database identifier, not `zenApiKey`, an email address, or another credential. Omit it for anonymous traffic. |
| `x-real-ip` | Trusted ingress address currently read as `rawIp` | Canonicalize the trusted caller address and set one internal fallback-IP header for anonymous admission limiting. Remove caller-supplied `x-forwarded-for`, `cf-connecting-ip`, and `x-client-ip` values unless the console has deliberately sanitized one of them. The inference service trusts these headers because the console is its gateway. |
| `x-opencode-session` | Existing inbound `sessionId` | Copy the stable conversation value so weighted selection and persisted affinity behave consistently across turns. The inference service removes the inbound name before the provider call; OpenAI-compatible upstreams deliberately receive the value as generated `x-session-affinity`. |
| `x-opencode-region` | Pending console routing policy | Set only after the console has decided which provider operating regions are allowed for the request. Do not pass an arbitrary public value through unless public region selection is intentionally supported and validated. Omit the header to preserve unconstrained routing. |
| `x-request-id` | Existing inbound `x-opencode-request` or a console-generated request ID | Map this when upstream correlation is desired. `x-opencode-request` itself is gateway-owned and is intentionally stripped by the inference service. |

Build the internal header set from a small allowlist after console
authentication. Do not clone all public request headers. In particular, the
console must keep public protocol credentials at its authentication boundary;
the inference service selects provider credentials from its registry and does
not authenticate callers from `Authorization`, `x-api-key`, or
`x-goog-api-key`.

Response handling still to implement in the console:

- Consume and remove private-hop `x-opencode-inference-cost` from successful
  non-streaming responses before returning them publicly, and use the value for
  console billing and usage accounting.
- Consume terminal supplemental cost frames from successful streams before
  returning provider-compatible SSE publicly, using
  `makeInferenceCostFrameParser` from
  `@opencode-inference/inference/cost-frame`.
- Decide whether `x-opencode-matched-region` should be logged, returned to the
  caller, or removed at the console boundary. It reports the selected route's
  configured overlap, not a guaranteed physical execution location.
