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

One CLI session is opened per working directory, and every turn continues it, so the conversation the agent holds is the
conversation the user is having. The CLI can resume a session it already knows, which is what happens after the server
restarts.

## Tools

The agent runs its own tools, and reports them as tool calls. OpenCode surfaces them as provider-executed tool calls,
so the run shows what the agent did, but OpenCode does not run them and does not have tools with those names.

Permission requests the agent makes are refused by default: the agent may not act on the machine on its own unless the
host answers them.

## Cost

A consumer Antigravity subscription covers the usage, so no cost is shown.

## Capability limits

- The agent's tool calls are provider executed, so OpenCode's permissions and tool policies do not gate them.
- The agent's own permission model governs what it may change on the machine.
- The agent cannot be steered mid-turn.
- The provider is skipped where OpenCode cannot start local programs, such as remote workspaces.

## Shipping

- The provider is built into core, not shipped as a separate package, so it follows the Claude Agent provider's shape.
- `@agentclientprotocol/sdk` is a dependency of `packages/core`. The SDK's client side carries the protocol; the
  Antigravity-specific parts are the CLI's own session and model payloads.
