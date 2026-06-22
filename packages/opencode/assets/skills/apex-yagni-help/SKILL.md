---
name: APEX YAGNI-help
description: >
  Quick-reference card for all APEX YAGNI modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /apex-yagni-help,
  "APEX YAGNI help", "what APEX YAGNI commands", "how do I use APEX YAGNI".
---

# APEX YAGNI Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/apex-yagni lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `/apex-yagni` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `/apex-yagni ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **APEX YAGNI** | `/apex-yagni` | Lazy mode itself. Simplest solution that works. |
| **APEX YAGNI-review** | `/apex-yagni-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **APEX YAGNI-gain** | `/apex-yagni-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **APEX YAGNI-help** | `/apex-yagni-help` | This card. |

Codex uses `@APEX YAGNI`, `@APEX YAGNI-review`, and `@APEX YAGNI-help`; Claude Code
and OpenCode use the slash-command forms above (OpenCode ships `/apex-yagni` and
`/apex-yagni-review`).

## Deactivate

Say "stop APEX YAGNI" or "normal mode". Resume anytime with `/apex-yagni`.
`/apex-yagni off` also works.

## Configure Default Mode

Default mode = `full`, auto-active every session. Change it:

**Environment variable** (highest priority):
```bash
export APEX YAGNI_DEFAULT_MODE=ultra
```

**Config file** (`~/.config/apex-yagni/config.json`, Windows: `%APPDATA%\APEX YAGNI\config.json`):
```json
{ "defaultMode": "lite" }
```

Set `"off"` to disable auto-activation on session start, activate manually
with `/apex-yagni` when wanted.

Resolution: env var > config file > `full`.

## Update

Enable auto-update once: open `/plugin`, go to Marketplaces, pick APEX YAGNI, Enable auto-update. Claude Code then pulls new versions at startup (run `/reload-plugins` when it prompts). Manual refresh: `/plugin marketplace update APEX YAGNI` then `/reload-plugins`.

If `/plugin` is not recognized, your Claude Code is out of date. Update it (`npm install -g @anthropic-ai/claude-code@latest`, or `brew upgrade claude-code`) and restart. Other hosts use their own update flow.

## More

Full docs + examples: https://github.com/DietrichGebert/apex-yagni
