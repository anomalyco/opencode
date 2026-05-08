# Tier: Browser Reel

Capture 3-5 browser screenshots at key UI states and stitch into an animated GIF.

**Best for:** Web apps, desktop apps accessible via localhost or CDP.
**Output:** GIF (PNG screenshots stitched via ffmpeg two-pass palette)
**Label:** "Demo"
**Required tools:** agent-browser, ffmpeg

If `agent-browser` is not installed, inform the user: "`agent-browser` is not installed. Run `/ce-setup` to install required dependencies." Then fall back to a lower tier (static screenshots or skip).

## Step 1: Connect to the Application

**For web apps** -- verify the dev server is accessible:

- Read `package.json` `scripts` for `dev`, `start`, `serve` commands
- Check `Procfile`, `Procfile.dev`, or `bin/dev` if they exist
- Check `Gemfile` for Rails (`bin/rails server`) or Sinatra
- Check for running processes on common ports (3000, 5000, 8080)

If the server is not running, tell the user what start command was detected and ask them to start it. Do not start it automatically (it may require environment variables, database setup, etc.).

If the server cannot be reached after the user confirms it should be running, fall back to static screenshots tier.

Once accessible, note the base URL (e.g., `http://localhost:3000`).

**For Electron/desktop apps** -- connect via Chrome DevTools Protocol (CDP):

1. Check if the app is already running with CDP enabled by probing common ports:
   ```bash
   curl -s http://localhost:9222/json/version
   ```
   If that returns a JSON response, the app is ready -- connect agent-browser to it:
   ```bash
   agent-browser connect 9222
   ```

2. If not running, the app needs to be launched with `--remote-debugging-port`. Detect the entry point from `package.json` (look for the `main` field or `electron` in scripts), then ask the user to launch it with:
   ```
   your-electron-app --remote-debugging-port=9222
   ```
   If port 9222 is busy, try 9223-9230.

3. Poll until CDP is ready (timeout after 30 seconds):
   ```bash
   curl -s http://localhost:9222/json/version
   ```

4. Connect agent-browser:
   ```bash
   agent-browser connect 9222
   ```

**CDP advantages:** Screenshots come from the renderer's frame buffer, not macOS screen capture -- no Accessibility or Screen Recording permissions needed.

**If CDP connection fails:** Fall back to static screenshots tier. Tell the user: "Could not connect to the app via CDP. Falling back to static screenshots."

## Step 2: Capture Screenshots

Navigate to the relevant pages and capture 3-5 screenshots at key UI states:

1. **Initial/empty state** -- Before the feature is used
2. **Navigation** -- How the user reaches the feature (if not the landing page)
3. **Feature in action** -- The hero shot showing the feature working
4. **Result state** -- After interaction (data present, items created, success message)
5. **Detail view** (optional) -- Expanded item, settings panel, modal

For each screenshot, write to the concrete `RUN_DIR` created by the parent skill:

```bash
agent-browser open [URL]
```

```bash
agent-browser wait --load networkidle
```

```bash
agent-browser wait 1000
```

```bash
agent-browser screenshot [RUN_DIR]/frame-01-initial.png
```

**Capture tips:**
- Use URL navigation (`agent-browser open URL`) rather than clicking SPA elements (clicks often fail on React/Vue/Svelte SPAs)
- Wait for `--load networkidle` after navigation, then a short fixed buffer for any post-fetch render. A fixed `wait 2000` alone is not enough on SPAs that fetch data after paint -- screenshots will capture the empty shell.
- For pages that keep network activity open (websockets, long-polling), use `agent-browser wait --text "<known content>"` to wait for a specific string from the populated UI, or `agent-browser wait --fn "<expression>"` for a custom readiness condition.
- Capture the full viewport (sidebar, header give reviewers context)

**Keep secrets out of frame:**
- Do not open DevTools, the Network panel, or Application/Storage -- these expose auth headers, cookies, session storage, and tokens in plain view
- Skip pages that display raw credentials (unmasked API-key settings, OAuth consent screens, `.env` viewers, billing/payment detail)
- Check the URL bar before each screenshot -- if it carries a session token or credential query param (`?access_token=`, `?api_key=`, `#id_token=`), navigate to the clean canonical URL first
- Prefer a demo account or seeded fixture data over a real logged-in account when the screenshot will include account identifiers that are themselves sensitive

## Step 3: Stitch into GIF

Use the capture pipeline script to normalize frame dimensions, stitch with two-pass palette, and auto-reduce if over 10 MB:

```bash
python3 scripts/capture-demo.py stitch [RUN_DIR]/demo.gif [RUN_DIR]/frame-*.png
```

The script handles dimension normalization (via ffprobe + ffmpeg padding), concat demuxer stitching, palette generation, and automatic frame reduction if the GIF exceeds GitHub's 10 MB inline limit. Default is 3 seconds per frame. To adjust:

```bash
python3 scripts/capture-demo.py stitch --duration 2.0 [RUN_DIR]/demo.gif [RUN_DIR]/frame-*.png
```

**If stitching fails:** Fall back to static screenshots tier using the individual PNGs already captured. If no PNGs were captured, report the failure.

## Step 4: Secrets Scan and Cleanup

Before uploading, inspect the final GIF for any credential material visible on-screen. If any appears, discard the GIF and recapture with the offending page or state routed out of frame. Do not upload, do not blur.

After a clean GIF is confirmed, remove individual PNG frames. Keep only the final GIF for upload.

Proceed to `references/upload-and-approval.md`.
