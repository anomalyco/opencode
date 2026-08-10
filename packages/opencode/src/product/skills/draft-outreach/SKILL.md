---
name: draft-outreach
description: Draft recruiter outreach (email or LinkedIn) from req and candidate notes. Never send. Use when the user wants first-touch or follow-up copy.
---

# draft-outreach

Draft outreach only. Do not send email, LinkedIn, or ATS messages.

## Discover inputs

1. User-attached paths / pasted notes
2. Cwd or `.moks/req/`: `jd.md`, optional `resume.md`, notes
3. Prior score brief in the conversation if present

## Clarify channel

Default to a short email + optional LinkedIn DM variant unless the user specifies one.

## Output format

```markdown
# Outreach draft: <candidate> · <role>

## Email
Subject: ...

Body:
...

## LinkedIn (optional)
...

## Personalization hooks
- Facts from resume/notes used (with paths)

## Open questions
- Missing sender/company details still needed
```

## Rules

- No fake claims about comp, team, or process not in materials
- Keep under ~150 words for first touch unless asked for longer
- Never call send APIs or claim a message was delivered
- If candidate contact is missing, draft body and note that recipient is unset
