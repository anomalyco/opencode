<p align="center">
  <img src="assets/kancode.png" alt="KanCode" width="128" />
</p>

<p align="center">
  <a href="https://github.com/puetsua/kancode">
    <strong>KanCode</strong>
  </a>
</p>
<p align="center">The open source AI coding agent (TUI / CLI). Fork of OpenCode with dual-read config compatibility.</p>

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

`bun dev` starts the KanCode TUI. To run it against another directory:

```bash
bun dev <directory>
# or the repo root itself
bun dev .
```

The CLI script name is `kancode`; `opencode` remains an alias/shim when installed as a package bin.

### Config compatibility

KanCode keeps OpenCode configs working in projects; user/global scope is KanCode-only:

| Kind | Preference |
| --- | --- |
| Project config files | Prefer `kancode.json` / `kancode.jsonc`; else `opencode.json` / `opencode.jsonc` (first existing wins per directory; do not merge both names in the same dir) |
| Project dirs | Load both `.kancode/` and `.opencode/`; `.kancode` wins on conflicting keys |
| User scope (XDG/global, `~/.kancode`) | KanCode only: `kancode.json(c)` and `.kancode/` — do **not** read `opencode.json` or `~/.opencode` |
| Env flags | Honor `OPENCODE_*`; `KANCODE_*` aliases map to the same flags (`KANCODE_*` wins when both set) |
| XDG / data dirs | Config path is always `…/kancode`; data/cache/state/tmp prefer nonempty `kancode`, else fall back to existing `opencode` dirs |

Issues and feedback: [puetsua/kancode](https://github.com/puetsua/kancode/issues).

Upstream OpenCode docs still describe shared features: [opencode.ai/docs](https://opencode.ai/docs).

### Agents

KanCode includes two built-in agents you can switch between with the `Tab` key.

- **default** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents) (upstream docs).

### Documentation

For shared configuration details, see the upstream [OpenCode docs](https://opencode.ai/docs). For this fork, prefer the README and `AGENTS.md` in the repo.
