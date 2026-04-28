---
name: codex-bug
description: Diagnose GitHub bug reports in openai/codex. Use when given a GitHub issue URL from openai/codex and asked to decide next steps such as verifying against the repo, requesting more info, or explaining why it is not a bug; follow any additional user-provided instructions.
---

# Codex Bug

## Overview

Diagnose a Codex GitHub bug report and decide the next action: verify against sources, request more info, or explain why it is not a bug.

## Workflow

1. Confirm the input

- Require a GitHub issue URL that points to `github.com/openai/codex/issues/…`.
- If the URL is missing or not in the right repo, ask the user for the correct link.

2. Network access

- Always access the issue over the network immediately, even if you think access is blocked or unavailable.
- Prefer the GitHub API over HTML pages because the HTML is noisy:
  - Issue: `https://api.github.com/repos/openai/codex/issues/<number>`
  - Comments: `https://api.github.com/repos/openai/codex/issues/<number>/comments`
- If the environment requires explicit approval, request it on demand via the tool and continue without additional user prompting.
- Only if the network attempt fails after requesting approval, explain what you can do offline (e.g., draft a response template) and ask how to proceed.

3. Read the issue

- Use the GitHub API responses (issue + comments) as the source of truth rather than scraping the HTML issue page.
- Extract: title, body, repro steps, expected vs actual, environment, logs, and any attachments.
- Note whether the report already includes logs or session details.
- If the report includes a thread ID, mention it in the summary and use it to look up the logs and session details if you have access to them.

4. Summarize the bug before investigating

- Before inspecting code, docs, or logs in depth, write a short summary of the report in your own words.
- Include the reported behavior, expected behavior, repro steps, environment, and what evidence is already attached or missing.

5. Decide the course of action

- **Verify with sources** when the report is specific and likely reproducible. Inspect relevant Codex files (or mention the files to inspect if access is unavailable).
- **Request more information** when the report is vague, missing repro steps, or lacks logs/environment.
- **Explain not a bug** when the report contradicts current behavior or documented constraints (cite the evidence from the issue and any local sources you checked).

6. Respond

- Provide a concise report of your findings and next steps.
