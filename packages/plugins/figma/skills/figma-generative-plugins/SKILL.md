---
name: figma-generative-plugins
description: "**MANDATORY prerequisite** — load this skill before calling `create_generative_plugin` or `update_generative_plugin`. Use when the user asks to create, author, change, fix, or extend a reusable generative Figma plugin."
disable-model-invocation: false
---

# Create and update generative Figma plugins

Load this skill before every `create_generative_plugin` or `update_generative_plugin` call. In user-facing language, call the result a “plugin.” The “generative” qualifier only distinguishes this account-library tool from other plugin systems.

## Preflight

Before authoring, confirm the request fits this surface:

- Plugins run in the Figma Design editor.
- Every plugin must provide functional UI for its core workflow. A plugin with no configurable inputs still needs a clear primary action and useful status or validation feedback.
- Never embed API keys, OAuth tokens, signed URLs, or other secrets. Plugin source is readable by people who can access it. For authenticated integrations, stop and offer a static dataset, a public no-auth endpoint, or a different architecture.

## Create workflow

1. Resolve the requested workflow and its useful controls. Ask a concise question only if required inputs or behavior are genuinely ambiguous.
2. Resolve `planKey`. Reuse one supplied by the user; otherwise call `whoami`. Use the sole eligible plan automatically, or ask the user to choose when several materially different plans are available.
3. Call `create_generative_plugin` once with a concise name, description, and `planKey`. This creates a runnable square-drawing scaffold, not the requested final plugin.
4. Call `get_generative_plugin` with the returned `id`, then read every source URI. This establishes the scaffold's manifest, UI message contract, and current TypeScript entrypoint.
5. Replace the scaffold with complete authored files for the requested behavior and UI.
6. Call `update_generative_plugin` with the returned `id`, a `files` array containing complete replacements for `code.ts` and, when the UI changes, `ui.html`, plus a specific `commitMessage`. Use `metadata` when changing the name or description.

Never stop after `create_generative_plugin`: the starter must be replaced with the requested experience.

## Update workflow

1. Identify the plugin. If needed, call `list_generative_plugins`, then `get_generative_plugin`.
2. Read every source URI returned by the get tool before editing. Treat those files as the current source of truth.
3. Preserve existing UI, controls, relaunch behavior, validation, and user-visible affordances unless the user asks to change them.
4. Call `update_generative_plugin` with complete replacement content for every changed existing file. Use `{ path: "code.ts", content: "..." }` for the entrypoint and `{ path: "ui.html", content: "..." }` for the UI. Unspecified files are preserved.

## Authoring rules

- Before writing replacement files, read [Plugin source authoring](references/authoring.md). It covers the file replacement contract, UI/message lifecycle, PropsKit controls, dynamic-page compatibility, fonts, relaunch behavior, bounded work, geometry, and Plugin API gotchas.
- Keep the plugin’s primary action obvious and make invalid selection or input states understandable.
- `update_generative_plugin` can replace existing `code.ts` and `ui.html` files, but cannot replace `manifest.json` or create new files. Keep `figma.showUI(__html__, ...)` in `code.ts` and replace `ui.html` when the requested workflow needs different controls.
- Avoid destructive canvas changes unless they are the explicit purpose of the plugin and the UI makes that clear.
- Do not close before asynchronous work and UI messages have completed.
- Treat a non-error `update_generative_plugin` result as success. Record the returned version when present; a successful response may omit it.
- On a build error, use the returned compiler output to make the smallest source correction and retry once. If it still fails, surface the error instead of repeatedly rewriting the plugin.

## Completion

Report the plugin name and id, plus the returned version when present and a short description of its UI and primary action. Construct and include a clickable URL that opens a new Design file with the unpublished plugin ready to try, using the exact plugin id as `try-tool-resource-content-id`:

`https://www.figma.com/file/new?try-tool-resource-content-id=<id>&try-tool-resource-type=gen_tool&type=design&mode=design`

After presenting the new-file link, ask whether the user wants to open the plugin in an existing Figma Design file instead. If yes, reuse a file URL already provided or ask for one, then add the same `try-tool-resource-content-id` and `try-tool-resource-type` query parameters to that URL. Never guess the file URL.
