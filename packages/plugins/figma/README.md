# Figma

An opt-in OpenCode plugin that registers Figma's remote MCP server and official Figma skills. It uses OpenCode's existing OAuth/DCR flow and credential storage, without a shared client secret.

## Install

Install directly from Git:

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/figma'
```

The URL selects the Figma directory and uses the repository's default branch, so no explicit branch name is needed. Installation is Git-only.

The plugin exports `index.ts` directly. There is no build step or installation hook.

For local development, add the directory to `plugins` in the project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./packages/plugins/figma"],
}
```

The plugin is not activated merely by being present in the repository. Installing it adds it to the user's configuration.

## Sign in and test

1. Open `/mcps`, select `figma`, and sign in.
2. Confirm that the server is connected.
3. Ask the agent to call Figma's `whoami` tool.

The connection uses Figma's public endpoint with dynamic client registration (DCR). OAuth discovery supplies the scope, and OpenCode chooses an available loopback callback port; no client credentials or explicit OAuth settings are needed.

Existing `mcp.servers.figma` configuration takes precedence, including disabled servers and custom endpoints.

## Official skills

`skills/` contains the complete skill bundle copied unchanged from the pinned revision of [Figma's official plugin](https://github.com/figma/mcp-server-guide/tree/main/skills). [skills-source.json](skills-source.json) records the exact upstream revision and the discovered skill IDs; it is not an allowlist.

The bundle covers design-to-code, canvas editing, screen and library generation, Code Connect, file creation, diagrams, FigJam, Slides, motion, SwiftUI, shaders, and generative plugins. Supporting references and scripts are included. No replacement instructions are authored by OpenCode. Existing skills with the same IDs are preserved.

The vendored Figma materials remain Figma's materials, not OpenCode-authored MIT code. See [skills/NOTICE.md](skills/NOTICE.md) for attribution and the Figma Developer Terms.

## Manually sync skills

From `packages/plugins/figma`, explicitly run:

```sh
bun run sync:skills
```

This fetches upstream `main`, discovers every skill directory containing `SKILL.md`, copies all of them with their supporting files, removes previously bundled skills that no longer exist upstream, and records the resolved commit and skill IDs. No skill names are filtered or hardcoded in the sync script. To use a particular branch, tag, or commit, pass it as an argument. To reproduce the current bundle, pass the revision in `skills-source.json`.

Review and commit `skills/` and `skills-source.json` together. Sync replaces local edits within bundled skill directories, so keep the upstream files unchanged and review updates before releasing them.

Sync never runs automatically during installation, plugin startup, typechecking, or CI. The plugin loads only the checked-in files. Supporting Figma scripts are guidance assets; the plugin does not execute them.

## Remove

```sh
opencode plugin remove 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/figma'
```

If you installed with a different Git specification, pass that same specification to remove it. An independently configured `mcp.servers.figma` entry remains unaffected.
