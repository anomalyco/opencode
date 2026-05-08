# Tier: Screenshot Reel

Render styled terminal frames from text and stitch into an animated GIF. Each frame shows one step of a CLI demo (command + output).

**Best for:** CLI tools shown as discrete steps (command -> output -> next command -> output). Also useful when VHS breaks on quoting or special characters.
**Output:** GIF (silicon PNGs stitched via ffmpeg)
**Label:** "Demo"
**Required tools:** silicon, ffmpeg

## Step 1: Write Demo Content

Create a text file with `---` delimiters between frames. Each frame shows the terminal state for one step:

Write to `[RUN_DIR]/demo-steps.txt`:

```
$ your-cli-command --flag value
Output line 1
Output line 2
Success: feature works correctly
---
$ your-cli-command --another-flag
Different output showing another aspect
Result: 42 items processed
---
$ your-cli-command --verify
All checks passed
```

**Tips:**
- Include the `$` prompt to show what the user types
- Keep each frame under ~80 characters wide for readability
- 3-5 frames is ideal -- enough to tell the story, not so many the GIF is huge
- Strip unicode characters that silicon's default font can't render (checkmarks, fancy arrows)

**Never write secrets into the demo text:**
- Do not paste real credentials, API keys, tokens, or session IDs into any frame, even if copied from a real run
- Do not substitute fake-looking credentials like `sk-xxxxxxxxx` either -- that produces a misleading artifact. Instead, rewrite the command to use an env var whose *name* appears without a value (e.g., `your-cli --api-key "$API_KEY"`), or demonstrate a different command that doesn't take a secret
- If a sample output line would include a token, error trace with auth header, or other credential, edit that line out or pick a different scenario -- do not render it

## Step 2: Split into Frame Files

Split the demo content on `---` lines into separate text files, one per frame:

- `[RUN_DIR]/frame-001.txt`
- `[RUN_DIR]/frame-002.txt`
- `[RUN_DIR]/frame-003.txt`
- etc.

## Step 3: Render and Stitch

Use the capture pipeline script to render each text frame through silicon and stitch into an animated GIF in a single call:

```bash
python3 scripts/capture-demo.py screenshot-reel --output [RUN_DIR]/demo.gif --duration 2.5 --text [RUN_DIR]/frame-001.txt [RUN_DIR]/frame-002.txt [RUN_DIR]/frame-003.txt
```

The script handles silicon rendering, dimension normalization, two-pass palette generation, and automatic frame reduction if the GIF exceeds limits. Default duration is 2.5 seconds per frame (faster than browser reels since terminal frames are quicker to read).

**If the script fails** (silicon rendering error, stitching error, empty output): fall back to static screenshots tier. Include the raw terminal output as a code block in the PR description instead. Label as "Terminal output", not "Screenshots".

## Step 4: Cleanup

Remove individual PNGs and text files. Keep only the final GIF for upload.

Proceed to `references/upload-and-approval.md`.
