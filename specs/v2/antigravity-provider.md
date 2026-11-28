# Antigravity Provider

## Overview

The Antigravity provider lets people use Google's Antigravity models in OpenCode with their own Antigravity login.
OpenCode runs the Antigravity CLI on the user's machine and talks to it over the Agent Client Protocol, the way the
Claude Agent provider runs Claude Code and talks to it through Anthropic's Agent SDK.

The idea is that all of OpenCode's UX stays the same, and Antigravity becomes another provider.

## Name and Login

The provider is called "Google Antigravity", with the ID `antigravity`.

OpenCode runs the user's own `agy` binary, found on `PATH` or set with `OPENCODE_ANTIGRAVITY_PATH`. It only uses the
public Agent Client Protocol. It never sits between the CLI and Google, and it never reads the CLI's credentials.

The user signs in with `agy` in their terminal. Any sign-in the CLI supports works.

## Which CLI surface is used

The Antigravity CLI has two headless surfaces, and only one of them may be driven by another program.

- `agy -p "<prompt>"` is the CLI's print mode. Google's Antigravity FAQ says that wrapping it inside a third-party
  coding agent is not supported on consumer plans, and the Antigravity Additional Terms (section 6) say that using
  third-party software to access the Service is a breach of the agreement.
- `agy acp` is the CLI's Agent Client Protocol server. Google's FAQ names the unmodified `antigravity-acp` runtime with
  native `oauth-personal` sign-in as usable for single-user interactive development.

This provider drives `agy acp` and never `agy -p`. Where a third-party agent needs Gemini outside the Antigravity
subscription, Google points at a Gemini API key, Vertex AI or Gemini Enterprise.

## What the model sees

- The agent runs with the Antigravity CLI's own system prompt and its own tools.
- The user's text is sent as the turn. OpenCode's system prompt is not forwarded: it describes OpenCode's tools, which
  the agent does not have.
- The agent reads the project's own instruction files (`AGENTS.md` and the rest), the way it does in its own terminal.

## Models

The model list comes from the account. The CLI reports the models it may use when it opens a session, and OpenCode
registers exactly those, so the list is never written down in OpenCode and a model Google adds shows up without a change
here.

The CLI names the reasoning effort as part of the model: `gemini-3.8-flash-high`, `gemini-3.8-flash-medium` and
`gemini-3.8-flash-low` are one model at three effort levels. OpenCode registers one model per model, with the effort
levels as variants, the same shape the Claude Agent provider uses.

A model the CLI lists without an effort level of its own, such as `claude-sonnet-4-6`, is registered with no variants
and keeps the CLI's own name.

## Sessions

One CLI process runs per OpenCode server, started on the first turn. Each OpenCode session gets its own CLI session, so
two OpenCode sessions never continue each other's conversation, and the CLI session is closed when the OpenCode session
is deleted. Requests outside a session's conversation, such as titles, run in a CLI session that is closed after the
turn. Before each turn the CLI session is switched to the model and effort level the user picked. If the CLI exits, the
next turn starts a new one.

The model list is kept between starts. With a kept list the CLI is not started until the first turn; without one it is
asked for the list at startup, and only when `agy` is on `PATH`.

## Tools

The agent runs its own tools, and reports them as tool calls. OpenCode surfaces them as provider-executed tool calls,
so the run shows what the agent did, but OpenCode does not run them and does not have tools with those names.

When the agent asks for permission, OpenCode checks the request against the session's permission rules for the agent that
runs the turn, and asks the user when a rule says to. The agent's kind of tool maps onto OpenCode's actions: `edit`,
`delete` and `move` to `edit`, `execute` to `bash`, `read` to `read`, `search` to `grep`, `fetch` to `webfetch`, and
anything else to `antigravity`. A request is refused when the rules deny it, when the user rejects it, or when it comes
from a request outside a session.

## Cost

A consumer Antigravity subscription covers the usage, so no cost is shown.

## Capability limits

- The agent's tool calls are provider executed. OpenCode's permission rules gate only what the agent asks permission
  for, and the CLI's own permission settings decide what it asks about.
- The agent cannot be steered mid-turn.
- The provider is skipped where OpenCode cannot start local programs, such as remote workspaces.

## Shipping

- The provider is built into core, not shipped as a separate package, so it follows the Claude Agent provider's shape.
- `@agentclientprotocol/sdk` is a dependency of `packages/core`. The SDK's client side carries the protocol; the
  Antigravity-specific parts are the CLI's own session and model payloads.
