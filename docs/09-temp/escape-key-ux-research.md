# Research: Escape Key Cancel UX

**Date:** 2026-02-24
**Status:** TODO — brainstorm in next session

## Problem
Pressing Escape accidentally during AI response immediately stops the response with no confirmation. No visual feedback in chat that response was interrupted.

## Current Behavior
- Escape → immediately cancels the LLM response
- Shows a notification/warning toast
- No visual indicator in the chat thread that the message was interrupted
- No confirmation dialog before cancelling

## User's Proposed Improvements
1. **Confirmation before cancel** — Alert/dialog: "Are you sure you want to interrupt?"
2. **Visual interruption indicator** — Show in chat that the message was interrupted (red line, badge, etc.)
3. **Better UX** — Maybe double-tap Escape to cancel, or Escape once to show warning

## Files to Investigate
- `packages/app/src/pages/session.tsx` — handleKeyDown, Escape handling
- `packages/app/src/components/prompt-input.tsx` — Escape key handling in input
- `packages/opencode/src/session/prompt.ts` — cancel() function
- `packages/ui/src/components/message-part.tsx` — interrupted state rendering
- `packages/app/src/pages/session/use-session-commands.tsx` — session.cancel command

## Design Questions
1. Should Escape require double-tap? (like VS Code terminal)
2. Should there be a small "Esc to cancel" indicator during streaming?
3. Should interrupted messages have a visual indicator (red border/badge)?
4. Should there be an "undo cancel" option (resume if possible)?
5. How does Cline/Cursor handle this?
