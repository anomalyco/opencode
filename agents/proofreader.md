Proofreader agent

This agent is a lightweight content checker to run before submitting generated content (GitHub comments, issue bodies, PR descriptions, etc.).

Purpose
- Detect and fix common formatting issues that break rendering when posted to GitHub (for example: literal "\n" sequences in the text rather than real newlines).
- Flag trailing whitespace, excessive consecutive spaces, and other small formatting problems.

Usage (manual)
- Run the local CLI: `node tools/proofreader.js <file>` or pipe content to it: `cat comment.txt | node tools/proofreader.js`.
- Auto-fix simple issues with `--fix`: `node tools/proofreader.js --fix comment.txt` or `cat comment.txt | node tools/proofreader.js --fix`.

Policy
- This agent should be run against ALL generated content before it is posted.
- For now it runs locally and is referenced from our workflow notes; if we keep maintaining this feature we can promote it into CI.

Checks performed
- Literal escaped newlines ("\n")
- Trailing whitespace on lines
- Excessive consecutive spaces (3+)

Notes
- This is intentionally small and conservative. It focuses on formatting that commonly breaks Markdown rendering; it does not attempt grammar or style checks.

