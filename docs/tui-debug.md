# TUI Debugging Notes

Quick reminders for exercising the OpenTUI client while you diagnose rendering quirks or attachment behaviour.

## Launching inside tmux
- Start a dedicated session (`tmux new-session -s debug`) so you can detach and reattach while iterating.
- From the repo root, run `bun run packages/opencode/src/index.ts`.
- If dependencies are missing, run `bun install` once, then retry.

## Handy environment toggles
- By default, running inside tmux automatically enables ASCII rendering (unless you override it). Disable with `OPENCODE_TUI_ASCII=0` if you prefer the styled renderer.
- `OPENCODE_TUI_ASCII=1` forces ASCII mode regardless of the terminal; we automatically fall back to the styled renderer when stdout isn’t a TTY.
- `OPENCODE_TUI_NO_ALT_SCREEN=1` keeps OpenTUI on the primary screen buffer; handy for non-ASCII captures or when you want Bash commands to leave scrollback.

## Reproduction checklist
- Use `shift+enter` (or `ctrl+j`) to insert literal newlines without submitting.
- Trigger `@` completions on blank lines and inline text to confirm behaviour is consistent.
- Submit a test prompt after each change and skim the transcript for unexpected attachments or spacing artefacts.

## Capturing evidence
- Break down user-supplied videos with `ffmpeg -i demo.mov -vf fps=1 tmp/frames/frame_%03d.png` to reason about individual frames.
- In ASCII mode, prefer reading the output directly inside tmux (the frame uses shaded block glyphs; raw files look noisy). If you need a log, `tmux pipe-pane -o -t dev 'cat >> ascii.log'` records frames and messages.
- Always `tmux kill-session -t dev` once you’re finished so stray ASCII loops don’t keep running.

_Last updated: November 4, 2025_
