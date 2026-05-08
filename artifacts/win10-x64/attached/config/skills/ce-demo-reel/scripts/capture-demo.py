#!/usr/bin/env python3
"""
Evidence capture pipeline — deterministic helpers for the demo-reel skill.

Subcommands:
  preflight                          Check tool availability (JSON output)
  detect [--repo-root PATH]          Detect project type from manifests (JSON output)
  recommend --project-type T --change-type T --tools JSON   Recommend capture tier (JSON output)
  stitch [--duration N] OUTPUT FRAME [FRAME ...]            Stitch frames into animated GIF
  screenshot-reel --output OUT [--duration N] [--lang L] [--theme T] --text F [F ...]   Render text frames via silicon + stitch
  terminal-recording --output OUT --tape TAPE               Run VHS tape file
  preview FILE                       Upload to litterbox (1h expiry) for preview
  upload FILE_OR_URL                 Upload/promote to catbox.moe (permanent)
  save-local --file F --branch B     Save artifact locally instead of uploading
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


# --- Config ---

MAX_GIF_SIZE = 10 * 1024 * 1024   # 10 MB — GitHub inline render limit
TARGET_GIF_SIZE = 5 * 1024 * 1024  # 5 MB — preferred target
DEFAULT_MIN_FRAME_BYTES = 20 * 1024  # Below this a screenshot is almost certainly blank
CATBOX_API = "https://catbox.moe/user/api.php"
LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php"


# --- Helpers ---

def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def check_tool(name):
    return shutil.which(name) is not None


def run_cmd(cmd, timeout=120):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        print(f"ERROR: Command timed out after {timeout}s: {' '.join(cmd)}", file=sys.stderr)
        return subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr=f"Timed out after {timeout}s")
    if result.returncode != 0:
        print(f"ERROR: Command failed (exit {result.returncode}): {' '.join(cmd)}", file=sys.stderr)
        if result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
    return result


def file_size_mb(path):
    return Path(path).stat().st_size / (1024 * 1024)


# --- Preflight ---

def cmd_preflight(_args):
    tools = {
        "agent_browser": check_tool("agent-browser"),
        "vhs": check_tool("vhs"),
        "silicon": check_tool("silicon"),
        "ffmpeg": check_tool("ffmpeg"),
        "ffprobe": check_tool("ffprobe"),
    }
    print(json.dumps(tools))


# --- Detect ---

ELECTRON_DEPS = {"electron", "electron-builder", "electron-forge", "electron-vite", "electron-packager"}
WEB_NODE_DEPS = {
    "react", "vue", "svelte", "astro", "next", "nuxt", "@angular/core", "solid-js",
    "@remix-run/react", "gatsby", "express", "fastify", "koa", "hono", "@hono/node-server",
}
WEB_RUBY_DEPS = {"rails", "sinatra", "hanami", "roda"}
WEB_GO_DEPS = {
    "github.com/gin-gonic/gin", "github.com/labstack/echo", "github.com/gofiber/fiber",
    "github.com/go-chi/chi", "github.com/gorilla/mux",
}
# Note: net/http is stdlib and won't appear in go.mod. The agent detects stdlib web
# servers from source imports in the diff and overrides the classification (Step 2).
WEB_PYTHON_DEPS = {"flask", "django", "fastapi", "starlette", "tornado", "sanic", "litestar"}
WEB_RUST_DEPS = {"actix-web", "axum", "rocket", "warp", "poem", "tide"}
CLI_RUBY_DEPS = {"thor", "gli", "dry-cli"}
CLI_PYTHON_DEPS = {"click", "typer", "argparse"}


def _read_file(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except (OSError, IOError):
        return None


def _has_any_dep(pkg_json, dep_names):
    deps = set(pkg_json.get("dependencies", {}).keys())
    dev_deps = set(pkg_json.get("devDependencies", {}).keys())
    all_deps = deps | dev_deps
    return bool(all_deps & dep_names)


def _detect_project_type(repo_root):
    root = Path(repo_root)

    # Try package.json first (used by multiple checks)
    pkg_json = None
    pkg_text = _read_file(root / "package.json")
    if pkg_text:
        try:
            pkg_json = json.loads(pkg_text)
        except json.JSONDecodeError:
            pass

    # 1. Desktop app (Electron)
    if pkg_json and _has_any_dep(pkg_json, ELECTRON_DEPS):
        return {"type": "desktop-app", "reason": "package.json contains Electron dependency"}

    # 2. Web app
    if pkg_json and _has_any_dep(pkg_json, WEB_NODE_DEPS):
        return {"type": "web-app", "reason": "package.json contains web framework dependency"}

    # Check vite with framework deps (vite alone could be anything)
    if pkg_json and _has_any_dep(pkg_json, {"vite"}):
        all_deps = set(pkg_json.get("dependencies", {}).keys()) | set(pkg_json.get("devDependencies", {}).keys())
        if all_deps & WEB_NODE_DEPS:
            return {"type": "web-app", "reason": "package.json contains vite with framework dependency"}

    gemfile = _read_file(root / "Gemfile")
    if gemfile:
        for dep in WEB_RUBY_DEPS:
            if dep in gemfile:
                return {"type": "web-app", "reason": f"Gemfile contains {dep}"}

    go_mod = _read_file(root / "go.mod")
    if go_mod:
        for dep in WEB_GO_DEPS:
            if dep in go_mod:
                return {"type": "web-app", "reason": f"go.mod contains {dep}"}

    for pyfile in ["pyproject.toml", "requirements.txt"]:
        content = _read_file(root / pyfile)
        if content:
            for dep in WEB_PYTHON_DEPS:
                if dep in content:
                    return {"type": "web-app", "reason": f"{pyfile} contains {dep}"}

    cargo = _read_file(root / "Cargo.toml")
    if cargo:
        for dep in WEB_RUST_DEPS:
            if dep in cargo:
                return {"type": "web-app", "reason": f"Cargo.toml contains {dep}"}

    # 3. CLI tool
    if pkg_json:
        if "bin" in pkg_json:
            return {"type": "cli-tool", "reason": "package.json has bin field"}
        if (root / "bin").is_dir():
            return {"type": "cli-tool", "reason": "bin/ directory exists"}

    if go_mod and (root / "cmd").is_dir():
        return {"type": "cli-tool", "reason": "go.mod with cmd/ directory"}

    if cargo and "[[bin]]" in cargo:
        return {"type": "cli-tool", "reason": "Cargo.toml has [[bin]] section"}

    pyproject = _read_file(root / "pyproject.toml")
    if pyproject:
        if "[project.scripts]" in pyproject or "[tool.poetry.scripts]" in pyproject:
            return {"type": "cli-tool", "reason": "pyproject.toml has script entry points"}
        for dep in CLI_PYTHON_DEPS:
            if dep in pyproject:
                return {"type": "cli-tool", "reason": f"pyproject.toml contains {dep}"}

    if gemfile:
        for dep in CLI_RUBY_DEPS:
            if dep in gemfile:
                return {"type": "cli-tool", "reason": f"Gemfile contains {dep}"}
        if (root / "bin").is_dir() or (root / "exe").is_dir():
            return {"type": "cli-tool", "reason": "Ruby project with bin/ or exe/ directory"}

    if go_mod and (root / "main.go").exists():
        return {"type": "cli-tool", "reason": "main.go exists without web framework"}

    # 4. Library
    manifests = ["package.json", "Gemfile", "go.mod", "Cargo.toml", "pyproject.toml", "setup.py"]
    has_manifest = any((root / m).exists() for m in manifests)
    if not has_manifest:
        # Check for gemspec
        has_manifest = bool(list(root.glob("*.gemspec")))

    if has_manifest:
        return {"type": "library", "reason": "package manifest exists but no web/CLI signals"}

    # 5. Text-only
    return {"type": "text-only", "reason": "no recognized package manifest"}


def cmd_detect(args):
    repo_root = args.repo_root or os.getcwd()
    result = _detect_project_type(repo_root)
    print(json.dumps(result))


# --- Recommend ---

def _recommend_tier(project_type, change_type, tools):
    has_browser = tools.get("agent_browser", False)
    has_vhs = tools.get("vhs", False)
    has_silicon = tools.get("silicon", False)
    has_ffmpeg = tools.get("ffmpeg", False)
    has_ffprobe = tools.get("ffprobe", False)
    has_stitch = has_ffmpeg and has_ffprobe  # stitching requires both

    recommended = None
    reasoning = ""

    if project_type == "web-app":
        if has_browser and has_stitch:
            recommended = "browser-reel"
            reasoning = "Web app with agent-browser and ffmpeg available"
        elif has_browser:
            recommended = "static-screenshots"
            reasoning = "Web app with agent-browser but no ffmpeg/ffprobe for stitching"
        else:
            recommended = "static-screenshots"
            reasoning = "Web app without agent-browser"

    elif project_type == "cli-tool":
        if change_type == "motion":
            if has_vhs:
                recommended = "terminal-recording"
                reasoning = "CLI tool with motion, VHS available"
            elif has_silicon and has_stitch:
                recommended = "screenshot-reel"
                reasoning = "CLI tool with motion, silicon + ffmpeg available (no VHS)"
            else:
                recommended = "static-screenshots"
                reasoning = "CLI tool with no capture tools available"
        else:  # states
            if has_silicon and has_stitch:
                recommended = "screenshot-reel"
                reasoning = "CLI tool with discrete states, silicon + ffmpeg available"
            elif has_vhs:
                recommended = "terminal-recording"
                reasoning = "CLI tool with discrete states, VHS available (no silicon)"
            else:
                recommended = "static-screenshots"
                reasoning = "CLI tool with no capture tools available"

    elif project_type == "desktop-app":
        if has_browser and has_stitch:
            recommended = "browser-reel"
            reasoning = "Desktop app with agent-browser and ffmpeg (via localhost/CDP)"
        else:
            recommended = "static-screenshots"
            reasoning = "Desktop app without agent-browser"

    elif project_type == "library":
        recommended = "static-screenshots"
        reasoning = "Library projects use static screenshots"

    else:  # text-only or unknown
        recommended = "static-screenshots"
        reasoning = "Fallback to static screenshots"

    # Build available tiers list
    available = []
    if has_browser and has_stitch:
        available.append("browser-reel")
    if has_vhs:
        available.append("terminal-recording")
    if has_silicon and has_stitch:
        available.append("screenshot-reel")
    available.append("static-screenshots")  # always available

    return {
        "recommended": recommended,
        "available": available,
        "reasoning": reasoning,
    }


def cmd_recommend(args):
    try:
        tools = json.loads(args.tools)
    except json.JSONDecodeError:
        die("--tools must be valid JSON")
    result = _recommend_tier(args.project_type, args.change_type, tools)
    print(json.dumps(result))


# --- Stitch ---

def _get_frame_dimensions(path):
    result = run_cmd([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path),
    ])
    if result.returncode != 0:
        die(f"ffprobe failed on {path}")
    parts = result.stdout.strip().split(",")
    return int(parts[0]), int(parts[1])


def _stitch_frames(output, frames, duration=3.0, min_frame_bytes=DEFAULT_MIN_FRAME_BYTES):
    if not frames:
        die("No input frames provided")

    for f in frames:
        if not Path(f).exists():
            die(f"Frame not found: {f}")
        if min_frame_bytes > 0:
            size = Path(f).stat().st_size
            if size < min_frame_bytes:
                die(
                    f"Frame {f} is {size} bytes, below the {min_frame_bytes}-byte minimum. "
                    f"PNG size is dominated by entropy, so this is usually -- but not always -- "
                    f"a page that had not finished loading when the screenshot was taken. "
                    f"If the page is genuinely loaded but compresses small (flat-color UI, "
                    f"sparse empty state, small viewport), pass --min-frame-bytes 0 to disable "
                    f"the check, or a smaller positive value to lower the threshold. "
                    f"Otherwise, re-capture after `agent-browser wait --load networkidle`."
                )

    if not check_tool("ffmpeg"):
        die("ffmpeg is not installed. Install with: brew install ffmpeg")
    if not check_tool("ffprobe"):
        die("ffprobe is not installed. Install with: brew install ffmpeg")

    print(f"Stitching {len(frames)} frames into GIF ({duration}s per frame)...")

    tmpdir = tempfile.mkdtemp(prefix="evidence-stitch-")
    try:
        # Detect max dimensions
        max_w, max_h = 0, 0
        for f in frames:
            w, h = _get_frame_dimensions(f)
            max_w = max(max_w, w)
            max_h = max(max_h, h)

        # Even dimensions
        if max_w % 2 != 0:
            max_w += 1
        if max_h % 2 != 0:
            max_h += 1

        print(f"  Target dimensions: {max_w}x{max_h}")

        # Normalize frames
        normalized = []
        for i, f in enumerate(frames):
            out = os.path.join(tmpdir, f"frame_{i:03d}.png")
            result = run_cmd([
                "ffmpeg", "-y", "-v", "error", "-i", f,
                "-vf", f"scale={max_w}:{max_h}:force_original_aspect_ratio=decrease,"
                       f"pad={max_w}:{max_h}:(ow-iw)/2:0:color=#0d1117",
                out,
            ])
            if result.returncode != 0:
                die(f"ffmpeg failed to normalize frame: {f}")
            normalized.append(out)

        print(f"  Normalized {len(normalized)} frames")

        # Write concat file
        concat_file = os.path.join(tmpdir, "concat.txt")
        with open(concat_file, "w") as fh:
            for f in normalized:
                fh.write(f"file '{os.path.basename(f)}'\n")
                fh.write(f"duration {duration}\n")
            # Last file repeated without duration (concat demuxer requirement)
            fh.write(f"file '{os.path.basename(normalized[-1])}'\n")

        # Two-pass palette generation
        palette = os.path.join(tmpdir, "palette.png")
        result = run_cmd([
            "ffmpeg", "-y", "-v", "error",
            "-f", "concat", "-safe", "0", "-i", concat_file,
            "-vf", "palettegen=stats_mode=diff",
            palette,
        ])
        if result.returncode != 0:
            die("ffmpeg palette generation failed")

        # Generate GIF with palette
        result = run_cmd([
            "ffmpeg", "-y", "-v", "error",
            "-f", "concat", "-safe", "0", "-i", concat_file,
            "-i", palette,
            "-lavfi", "paletteuse=dither=bayer:bayer_scale=3",
            "-loop", "0",
            output,
        ])
        if result.returncode != 0:
            die("ffmpeg GIF encoding failed")

        if not Path(output).exists():
            die("GIF creation failed: no output file")

        size = Path(output).stat().st_size
        size_mb = size / (1024 * 1024)
        print(f"  Created: {output} ({size_mb:.1f} MB, {len(frames)} frames)")

        # Auto-reduce if over limit
        if size > MAX_GIF_SIZE:
            print("  GIF exceeds 10 MB limit. Reducing...")
            if len(frames) > 2:
                print("  Dropping middle frame(s) and re-stitching...")
                reduced = [frames[0]]
                step = max(2, (len(frames) - 1) // 2)
                for j in range(step, len(frames) - 1, step):
                    reduced.append(frames[j])
                reduced.append(frames[-1])

                if len(reduced) < len(frames):
                    print(f"  Reduced from {len(frames)} to {len(reduced)} frames")
                    shutil.rmtree(tmpdir, ignore_errors=True)
                    _stitch_frames(output, reduced, duration, min_frame_bytes)
                    return
            print("  WARNING: Could not reduce below 10 MB. GIF may not render inline on GitHub.")
        elif size > TARGET_GIF_SIZE:
            print("  Note: GIF is over 5 MB preferred target but under 10 MB limit. Acceptable.")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def cmd_stitch(args):
    _stitch_frames(args.output, args.frames, args.duration, args.min_frame_bytes)


# --- Screenshot Reel ---

def cmd_screenshot_reel(args):
    if not check_tool("silicon"):
        die("silicon is not installed. Install with: brew install silicon")
    if not check_tool("ffmpeg"):
        die("ffmpeg is not installed. Install with: brew install ffmpeg")

    tmpdir = tempfile.mkdtemp(prefix="evidence-reel-")
    try:
        frame_pngs = []
        for i, text_file in enumerate(args.text):
            if not Path(text_file).exists():
                die(f"Text file not found: {text_file}")

            out_png = os.path.join(tmpdir, f"frame_{i:03d}.png")
            result = run_cmd([
                "silicon", text_file,
                "-o", out_png,
                "--theme", args.theme,
                "-l", args.lang,
                "--pad-horiz", "20",
                "--pad-vert", "40",
                "--no-line-number",
                "--no-round-corner",
                "--background", args.background,
            ])
            if result.returncode != 0 or not Path(out_png).exists():
                die(f"silicon failed to render {text_file}")
            frame_pngs.append(out_png)

        print(f"Rendered {len(frame_pngs)} frames via silicon")
        # silicon-rendered code frames are predictably small; the blank-screenshot
        # guard does not apply to this tier.
        _stitch_frames(args.output, frame_pngs, args.duration, min_frame_bytes=0)

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# --- Terminal Recording ---

def cmd_terminal_recording(args):
    if not check_tool("vhs"):
        die("vhs is not installed. Install with: brew install charmbracelet/tap/vhs")

    tape_path = args.tape
    if not Path(tape_path).exists():
        die(f"Tape file not found: {tape_path}")

    # Parse Output directive from tape file
    output_path = args.output
    tape_content = Path(tape_path).read_text()
    tape_has_output = False
    for line in tape_content.splitlines():
        stripped = line.strip()
        if stripped.startswith("Output "):
            tape_has_output = True
            if not output_path:
                output_path = stripped.split(None, 1)[1].strip().strip('"').strip("'")
            break

    if not output_path:
        die("No output path: use --output or set Output in the tape file")

    # If --output differs from tape's Output directive, rewrite to a temp tape
    actual_tape = tape_path
    tmp_tape = None
    if output_path and tape_has_output:
        # Rewrite the Output line to use the requested path
        lines = tape_content.splitlines()
        rewritten = []
        for line in lines:
            if line.strip().startswith("Output "):
                rewritten.append(f'Output "{output_path}"')
            else:
                rewritten.append(line)
        fd, tmp_tape = tempfile.mkstemp(suffix=".tape", prefix="vhs-")
        os.close(fd)
        Path(tmp_tape).write_text("\n".join(rewritten) + "\n")
        actual_tape = tmp_tape
    elif output_path and not tape_has_output:
        # No Output in tape — prepend one
        fd, tmp_tape = tempfile.mkstemp(suffix=".tape", prefix="vhs-")
        os.close(fd)
        Path(tmp_tape).write_text(f'Output "{output_path}"\n{tape_content}')
        actual_tape = tmp_tape

    print(f"Running VHS tape: {tape_path}")
    result = run_cmd(["vhs", actual_tape], timeout=300)

    if tmp_tape and Path(tmp_tape).exists():
        Path(tmp_tape).unlink()
    if result.returncode != 0:
        die(f"VHS failed (exit {result.returncode})")

    if not Path(output_path).exists():
        die(f"VHS produced no output at {output_path}")

    size = Path(output_path).stat().st_size
    size_mb = size / (1024 * 1024)
    print(f"Recording: {output_path} ({size_mb:.1f} MB)")
    print(json.dumps({"gif_path": str(output_path), "size_mb": round(size_mb, 1)}))


# --- Upload ---

def _upload_to(api_url, file_path, extra_fields=None):
    """Upload a file to a catbox-family API. Returns the URL or empty string."""
    if not check_tool("curl"):
        die("curl is not installed")

    cmd = [
        "curl", "-s", "--connect-timeout", "10",
        "-F", "reqtype=fileupload",
        "-F", f"fileToUpload=@{file_path}",
    ]
    for field in (extra_fields or []):
        cmd += ["-F", field]
    cmd.append(api_url)

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30, check=False,
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        print("ERROR: Upload timed out after 30s", file=sys.stderr)
        return ""


def _upload_with_retry(api_url, file_path, label, extra_fields=None):
    """Upload with one retry. Prints and returns the URL, or exits on failure."""
    size_mb = file_size_mb(file_path)
    print(f"Uploading {file_path} ({size_mb:.1f} MB) to {label}...")

    url = _upload_to(api_url, file_path, extra_fields)
    if url.startswith("https://"):
        print(f"Uploaded: {url}")
        print(url)
        return url

    print(f"ERROR: Upload failed. Response: {url[:200]}", file=sys.stderr)
    print(f"Local file preserved at: {file_path}", file=sys.stderr)
    print("Retrying in 2 seconds...", file=sys.stderr)
    time.sleep(2)

    url = _upload_to(api_url, file_path, extra_fields)
    if url.startswith("https://"):
        print(f"Uploaded (retry): {url}")
        print(url)
        return url

    print("ERROR: Retry also failed.", file=sys.stderr)
    sys.exit(1)


# --- Preview (litterbox — temporary, 1h expiry) ---

def cmd_preview(args):
    file_path = args.file
    if not Path(file_path).exists():
        die(f"File not found: {file_path}")
    _upload_with_retry(LITTERBOX_API, file_path, "litterbox (1h expiry)", ["time=1h"])


# --- Upload (catbox — permanent) ---

def _promote_url(source_url):
    """Promote a URL (e.g., litterbox preview) to permanent catbox hosting."""
    if not check_tool("curl"):
        die("curl is not installed")

    print(f"Promoting {source_url} to catbox.moe...")

    def _try():
        try:
            result = subprocess.run(
                ["curl", "-s", "--connect-timeout", "10",
                 "-F", "reqtype=urlupload",
                 "-F", f"url={source_url}", CATBOX_API],
                capture_output=True, text=True, timeout=30, check=False,
            )
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            print("ERROR: Upload timed out after 30s", file=sys.stderr)
            return ""

    url = _try()
    if url.startswith("https://"):
        print(f"Promoted: {url}")
        print(url)
        return url

    print(f"ERROR: Promote failed. Response: {url[:200]}", file=sys.stderr)
    print("Retrying in 2 seconds...", file=sys.stderr)
    time.sleep(2)

    url = _try()
    if url.startswith("https://"):
        print(f"Promoted (retry): {url}")
        print(url)
        return url

    print("ERROR: Retry also failed.", file=sys.stderr)
    sys.exit(1)


def cmd_upload(args):
    source = args.source
    if source.startswith("https://"):
        _promote_url(source)
    else:
        if not Path(source).exists():
            die(f"File not found: {source}")
        _upload_with_retry(CATBOX_API, source, "catbox.moe")


# --- Save local ---

def _sanitize_branch(branch):
    sanitized = branch.replace("/", "-")
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "", sanitized)
    sanitized = re.sub(r"-+", "-", sanitized).strip("-")
    return sanitized[:60]


def cmd_save_local(args):
    src = Path(args.file)
    if not src.exists():
        die(f"File not found: {src}")

    output_dir = Path(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    branch_part = _sanitize_branch(args.branch) if args.branch else "unknown"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    stem = re.sub(r"[^a-zA-Z0-9_-]", "", src.stem)[:40] or "artifact"
    filename = f"{branch_part}-{timestamp}-{stem}{src.suffix}"
    dest = output_dir / filename

    shutil.copy2(src, dest)
    dest_abs = str(dest.resolve())
    print(f"Saved: {dest_abs}")
    print(dest_abs)


# --- Main ---

def main():
    parser = argparse.ArgumentParser(
        description="Evidence capture pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  preflight                              Check tool availability (JSON)
  detect [--repo-root PATH]              Detect project type (JSON)
  recommend --project-type T ...         Recommend capture tier (JSON)
  stitch [--duration N] OUTPUT FRAMES    Stitch frames into animated GIF
  screenshot-reel --output O --text F    Render text via silicon + stitch
  terminal-recording --output O --tape T Run VHS tape
  preview FILE                           Upload to litterbox (1h expiry)
  upload FILE_OR_URL                     Upload/promote to catbox.moe (permanent)
  save-local --file F --branch B         Save artifact locally instead of uploading
""",
    )
    sub = parser.add_subparsers(dest="command")

    # preflight
    sub.add_parser("preflight", help="Check tool availability")

    # detect
    p_detect = sub.add_parser("detect", help="Detect project type")
    p_detect.add_argument("--repo-root", help="Repository root (default: cwd)")

    # recommend
    p_rec = sub.add_parser("recommend", help="Recommend capture tier")
    p_rec.add_argument("--project-type", required=True,
                       choices=["web-app", "cli-tool", "library", "desktop-app", "text-only"])
    p_rec.add_argument("--change-type", required=True, choices=["motion", "states"])
    p_rec.add_argument("--tools", required=True, help="JSON object of tool availability")

    # stitch
    p_stitch = sub.add_parser("stitch", help="Stitch frames into animated GIF")
    p_stitch.add_argument("--duration", type=float, default=3.0, help="Seconds per frame")
    p_stitch.add_argument(
        "--min-frame-bytes", type=int, default=DEFAULT_MIN_FRAME_BYTES,
        help=(
            "Minimum bytes per frame; smaller frames almost always mean a blank screenshot. "
            "Set to 0 to disable the check."
        ),
    )
    p_stitch.add_argument("output", help="Output GIF path")
    p_stitch.add_argument("frames", nargs="+", help="Input frame PNGs")

    # screenshot-reel
    p_reel = sub.add_parser("screenshot-reel", help="Render text frames via silicon + stitch")
    p_reel.add_argument("--output", required=True, help="Output GIF path")
    p_reel.add_argument("--duration", type=float, default=2.5, help="Seconds per frame")
    p_reel.add_argument("--lang", default="bash", help="Language for syntax highlighting")
    p_reel.add_argument("--theme", default="Dracula", help="Silicon theme")
    p_reel.add_argument("--background", default="#0d1117", help="Background color for frame border")
    p_reel.add_argument("--text", nargs="+", required=True, help="Text files (one per frame)")

    # terminal-recording
    p_term = sub.add_parser("terminal-recording", help="Run VHS tape file")
    p_term.add_argument("--output", help="Output GIF path (overrides tape Output directive)")
    p_term.add_argument("--tape", required=True, help="VHS tape file path")

    # preview
    p_preview = sub.add_parser("preview", help="Upload to litterbox (1h expiry) for preview")
    p_preview.add_argument("file", help="File to upload")

    # upload
    p_upload = sub.add_parser("upload", help="Upload or promote to catbox.moe (permanent)")
    p_upload.add_argument("source", help="Local file path or URL to promote")

    # save-local
    p_save = sub.add_parser("save-local", help="Save artifact locally instead of uploading")
    p_save.add_argument("--file", required=True, help="Artifact file to save")
    p_save.add_argument("--branch", default="", help="Branch name for filename")
    default_dir = "/tmp/compound-engineering/ce-demo-reel"
    p_save.add_argument("--output-dir", default=default_dir, help="Target directory")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "preflight": cmd_preflight,
        "detect": cmd_detect,
        "recommend": cmd_recommend,
        "stitch": cmd_stitch,
        "screenshot-reel": cmd_screenshot_reel,
        "terminal-recording": cmd_terminal_recording,
        "preview": cmd_preview,
        "upload": cmd_upload,
        "save-local": cmd_save_local,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
