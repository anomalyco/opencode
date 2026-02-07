# Fork Changes (lash vs upstream opencode)

Changes made to this fork that need reverting if merging back into upstream opencode.

## Logo

**File:** `src/cli/logo.ts`

The left side of the logo was changed from "open" to "lash".

**Upstream (open):**
```ts
left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
```

**Fork (lash):**
```ts
left: ["                   ", "█___ █▀▀█ █▀▀▀ █__█", "█___ █^^█ ^^^█ █^^█", "▀▀▀▀ ▀~~▀ ▀▀▀▀ ▀~~▀"],
```

Letter design (shadow markers: `_` = shadow bg, `^` = letter top/shadow bottom, `~` = shadow top):
```
L: █___  A: █▀▀█  S: █▀▀▀  H: █__█
   █___     █^^█     ^^^█     █^^█
   ▀▀▀▀     ▀~~▀     ▀▀▀▀     ▀~~▀
```
