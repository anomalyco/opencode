# Pattern: Audit -> Self-Fix -> Re-Audit

## Trigger

Any OpenFixer audit item marked `PARTIAL` or `FAIL`.

## Mandatory Loop

1. Record failed requirement and evidence path.
2. Apply minimal corrective change in same decision pass.
3. Re-run verification commands.
4. Re-audit all original requirements.
5. Update decision + deployment journal with both initial and re-audit matrices.

## Closure Rule

Do not close until all originally failed items are remediated or explicitly marked blocked with owner + next step.
