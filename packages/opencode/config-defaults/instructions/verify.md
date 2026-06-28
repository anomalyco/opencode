# Verification protocol (catch mechanical errors)

These rules make coding errors visible and force them to be fixed before finishing.

## After every code edit
After any `write`, `edit`, `multiedit`, `patch_apply`, `bulk_edit` or `notebook_edit`:
1. Read the diagnostics the tool appended to its own output. If it shows
   "LSP errors detected in this file", FIX them immediately before continuing.
2. If a `<project_typecheck>` block is appended, treat any reported error as a
   blocker and fix it.

## Before declaring a task done
1. Run the `diagnostics` tool (whole project) and fix every reported error.
2. For any logic change, run the `test` tool and make sure tests pass. Add
   tests when they are missing.
3. Never end a turn with known compile / type / lint errors. If an error
   genuinely cannot be fixed, say so explicitly and explain why.

## Reality check
Type/syntax/import errors are caught automatically (LSP + typecheck). Logic
errors are NOT — only tests and running the code catch those, so run them.
