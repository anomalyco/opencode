<p align="center">
  <picture>
    <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Fengru logo">
  </picture>
</p>
<p align="center">The open source AI coding agent with transactional execution runtime.</p>

---

[![Fengru Terminal UI](packages/web/src/assets/lander/screenshot.png)](#)

---

### Installation

```bash
# From source
git clone https://github.com/Fengrru/Fengru.git
cd Fengru
bun install
bun dev

# Or build a standalone executable
./packages/opencode/script/build.ts --single
```

> [!NOTE]
> Fengru is forked from [OpenCode](https://github.com/anomalyco/opencode). It retains full backward compatibility while adding a transactional AI programming execution runtime (Event Sourcing, layered checkpoints, DAG planning, metacognitive error recovery, and Git-based transactional filesystem).

### Architecture

Fengru runs two cooperating runtime layers:

- **Session Runtime** — Assembles durable conversational context for each provider turn (System Context, Context Epoch, Session History).
- **Engine Runtime** — Executes transactional multi-step plans with event-sourced persistence, L1/L2/L3 layered checkpoints, DAG task decomposition, and metacognitive error recovery.

See [CONTEXT.md](./CONTEXT.md) for the complete runtime architecture specification.

### Agents

Fengru includes multiple built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

### Development

- Requirements: Bun 1.3+
- Install dependencies and start the dev server:

  ```bash
  bun install
  bun dev
  ```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development guide.

### Contributing

If you're interested in contributing to Fengru, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Fengru

If you are working on a project that's related to Fengru and is using "fengru" as part of its name, please add a note to your README to clarify that it is not built by the Fengru team and is not affiliated with us in any way.

---

**Based on [OpenCode](https://github.com/anomalyco/opencode)** by anomalyco.
