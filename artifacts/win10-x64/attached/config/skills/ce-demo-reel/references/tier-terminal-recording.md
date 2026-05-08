# Tier: Terminal Recording

Record a terminal session using VHS (charmbracelet/vhs) to produce a GIF demo.

**Best for:** CLI tools, scripts, command-line features with interaction or motion (typing, streaming output, progressive rendering).
**Output:** GIF (direct from VHS)
**Label:** "Demo"
**Required tools:** vhs

## Step 1: Plan the Recording

Before generating a .tape file, determine:

- **What command(s) to run** -- The actual product command, not test commands. "I ran npm test" is test evidence, not a demo.
- **Expected output** -- What the terminal should show when the command succeeds.
- **Terminal dimensions** -- Wide enough for the longest output line, tall enough to avoid scrolling.
- **Timing** -- Target 5-10 seconds total. Enough sleep after each command for output to render.
- **Secret exposure points** -- Any step that could surface a credential: env exports, `source .env`, `printenv`/`env`/`set`, CLIs with `--api-key`/`--token` flags, verbose/debug flags, commands that echo tokens in output or error traces, shell prompts with env-interpolated `$VAR` segments. Set real credentials inside a `Hide` block at the top of the `.tape`, run `clear` at the end of the block to flush the buffer, then `Show`. Use a clean `HOME` (`export HOME=$(mktemp -d)`) inside `Hide` so personal dotfiles, cached CLI tokens, and env-interpolated prompts can't leak.

## Step 2: Generate .tape File

Write a VHS tape file to `[RUN_DIR]/demo.tape`:

```tape
Output [RUN_DIR]/demo.gif

Set FontSize 16
Set Width 800
Set Height 500
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

# Hidden prelude: clean HOME, set real secrets, any setup that would leak.
# These commands execute for real but never appear in the GIF.
# `clear` at the end flushes the buffer so Show starts on a clean screen.
Hide
Type "export HOME=$(mktemp -d)"
Enter
Type "export API_KEY='real-secret-value'"
Enter
Type "cd /path/to/project"
Enter
Type "clear"
Enter
Show

# Visible demo: commands consume the env set above, but never re-export,
# echo, or print it. Show the feature working -- not the auth mechanism.
Type "your-cli-command --flag value"
Enter
Sleep 3s

# Let viewer read the output
Sleep 2s
```

**Why this shape:** success of the visible command is itself evidence the credential was set — no need to show the auth step. Never add a visible `export SECRET=...` with a fake value: it leaks the variable name and breaks the demo.

**Key .tape directives:**
- `Output [path]` -- Where to write the GIF (must be first line)
- `Set FontSize [14-18]` -- Larger for readability
- `Set Width/Height [pixels]` -- Match content needs
- `Set Theme [name]` -- "Catppuccin Mocha" or "Dracula" are readable defaults
- `Set TypingSpeed [ms]` -- 30-50ms feels natural
- `Hide`/`Show` -- Skip boring setup (cd, source, npm install)
- `Type [text]` -- Types characters (does not execute)
- `Enter` -- Presses enter (executes the typed command)
- `Sleep [duration]` -- Wait for output to render

**Avoid:**
- Non-deterministic output (random IDs, timestamps that change between runs)
- Commands that require interactive input (prompts, password entry)
- Very long output that scrolls off screen

## Step 3: Run VHS

Use the capture pipeline script to execute the tape file and validate output:

```bash
python3 scripts/capture-demo.py terminal-recording --output [RUN_DIR]/demo.gif --tape [RUN_DIR]/demo.tape
```

The script runs VHS, validates the output exists, and reports the file size. If the GIF exceeds 10 MB, reduce by adjusting the .tape: smaller terminal dimensions (`Set Width/Height`), shorter recording (fewer sleeps), or lower font size. Re-run.

## Step 4: Quality Check

Read the generated GIF to verify:

1. Commands are visible and readable
2. Output renders completely (not cut off)
3. The feature being demonstrated is clearly shown

**Secrets scan (hard gate):** Scan the GIF for credential material. If any appears, discard and re-record with the leaking step wrapped in `Hide`/`Show` or replaced. Do not upload, do not blur.

**Drift check:** A broken visible command — `401 Unauthorized`, `Invalid API key`, `0 credits remaining`, empty output where data was expected — usually means a visible `export SECRET=...` after `Show` overwrote the real env. Fix the `.tape` so secrets are set in `Hide` only, never re-exported, and re-record.

If quality is poor, revise the .tape file and re-record.

**If VHS fails** (crashes, produces empty GIF, or the command being demonstrated fails): fall back to the screenshot reel tier. Write the same commands and expected output as text frames and stitch via silicon + ffmpeg. If silicon is also unavailable, fall back to static screenshots.

Proceed to `references/upload-and-approval.md`.
