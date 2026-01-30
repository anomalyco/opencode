---
description: Record a Q&A entry to a daily journal
---

Append a Q&A entry to `~/daily/YYYY-MM-DD.md` by default, or a chosen directory.

Do not ask follow-up questions. Keep responses to a single confirmation line.

Rules:
- Use the latest user question and latest assistant answer unless explicit arguments are provided.
- If two arguments are provided, use `$1` as question and `$2` as answer.
- If three arguments are provided, use `$1` as question, `$2` as answer, and `$3` as the output directory.
- Default directory is `~/daily` unless a directory argument is provided.
- If the question or answer is missing, do not write anything and respond: `Skipped: no recent Q&A to record.`
- Date format: YYYY-MM-DD (local time).
- If the file does not exist, create it with a first line `# YYYY-MM-DD`, then a blank line, then the entry.
- Entry format:
  <details>
  <summary>Question: {question}</summary>

  Time: YYYY-MM-DD HH:MM
  Mode: {plan|build|unknown}
  Directory: {project_path}
  Answer: {answer}
  </details>
- Determine the current mode (plan/build) and write it. If it cannot be determined, use `unknown`.

Write or append the entry using file tools. Use the resolved directory (argument or default).
