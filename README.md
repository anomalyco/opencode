<p align="center">
  <a href="https://github.com/puetsua/kancode">
    <strong>kancode</strong>
  </a>
</p>
<p align="center">The open source AI coding agent (TUI / CLI).</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

---

### Getting started

This fork is currently developed and run from source. Packaged releases (npm, Homebrew, Scoop, install scripts, desktop installers, etc.) are not published here yet.

**Requirements:** [Bun](https://bun.sh) 1.3+

```bash
git clone https://github.com/puetsua/kancode.git
cd kancode
bun install
bun dev
```

`bun dev` starts the OpenCode TUI. To run it against another directory:

```bash
bun dev <directory>
# or the repo root itself
bun dev .
```


### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, see the [docs](https://opencode.ai/docs).

