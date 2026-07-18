# Development

Run KanCode from source with Bun.

**Requirements:** [Bun](https://bun.sh) 1.3+

```bash
git clone https://github.com/puetsua/kancode.git
cd kancode
bun install
bun dev
```

`bun dev` starts the KanCode TUI (same as the `kancode` CLI).

```bash
# against another directory
bun dev <directory>
# or from this repo root
bun dev .
```

The CLI package name is `kancode` (`@puetsua/kancode` on npm). For published installs, see the [root README](../README.md).
