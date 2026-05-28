from __future__ import annotations

import argparse
import subprocess
import sys

from opencode_sdk import create_opencode


def get_git_diff(repo_path: str, base: str = "HEAD~1") -> str:
    result = subprocess.run(
        ["git", "diff", base],
        capture_output=True,
        text=True,
        cwd=repo_path,
    )
    if result.returncode != 0:
        print(f"git diff failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description="Review a git diff with OpenCode")
    parser.add_argument(
        "--repo-path",
        default=".",
        help="Path to the git repository (default: current dir)",
    )
    parser.add_argument(
        "--base",
        default="HEAD~1",
        help="Git revision to diff against (default: HEAD~1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=4096,
        help="OpenCode server port (default: 4096)",
    )
    args = parser.parse_args()

    diff = get_git_diff(args.repo_path, args.base)
    if not diff.strip():
        print("No diff found — nothing to review.")
        return

    print(f"Diff length: {len(diff)} characters")

    client, server = create_opencode(port=args.port)

    try:
        session = client.session_create()
        sid = session["id"]
        print(f"Session: {sid}")

        prompt = (
            "Please review the following code diff.\n"
            "Focus on: correctness, potential bugs, security issues, and code quality.\n"
            "Be concise.\n\n"
            f"```diff\n{diff}\n```"
        )
        client.session_prompt(sid, prompt)
        print("Review request sent, waiting for response...")

        messages = client.session_messages(sid)
        for msg in messages:
            role = msg.get("role", "?")
            content = str(msg.get("content", ""))
            print(f"\n--- [{role}] ---\n{content}")

    finally:
        server.close()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
