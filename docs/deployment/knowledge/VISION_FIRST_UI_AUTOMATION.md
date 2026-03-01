# Vision-First UI Automation

Decision links: `DECISION_124`

## Problem

Current reel spin path can stall in unstable click navigation due to drift between expected and actual UI state.

## Required Loop

1. Capture current screenshot.
2. Run multimodal/vision analysis to identify exact actionable element.
3. Execute one deterministic action (single click/input).
4. Capture post-action screenshot.
5. Verify state transition succeeded before continuing.

## Guardrails

- Never execute chained click sequences without intermediate visual verification.
- If state does not advance, reclassify screen and choose alternative action path.
- Write evidence screenshots and state labels into deployment journal artifacts.

## Decision Recall Integration

Before modifying selectors or click paths, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\P4NTH30N\OP3NF1XER\search-decisions.ps1" -Query "spin"
```
