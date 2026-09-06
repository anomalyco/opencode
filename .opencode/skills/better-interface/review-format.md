# Review output format

This is the format for a review `better-interface` orchestrates. A domain skill reporting on its own carries its own smaller format, in its `## Reporting` section.

## Scope and coverage

State the exact scope, stack and styling conventions, the project convention documents found in recon and any review boundary. Then show coverage:

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Files, components, states, or checks | Findings count or `Clear` |

Include every domain listed under `better-interface`'s **Use domain skills as the sources of truth**. `Clear` means inspected with no actionable finding; `Not reviewed` must explain why.

## Findings

One table, ordered by severity, then by reach:

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `src/Dialog.tsx:42` | `<button><XIcon /></button>` | Add `aria-label="Close"` and hide the icon from the accessibility tree | The icon-only control has no accessible name |

- **Severity** comes from `better-interface`'s **Rank by user impact**.
- **Location** cites `path/to/file:line`. Cite the exact screen and component when the artifact has no source files.
- **Before / After** show the current implementation and an actionable replacement. Never split them into separate "Before:" and "After:" lines.
- **Why** names the violated principle and its user impact.
- **Domain** is the owning skill without the `better-` prefix.

Each row is one root cause. Consolidate a repeated systemic issue into one row and list every affected location. Respect the finding cap. With no findings, omit the table and state "No actionable interface findings."

## Verification

List each check or interaction, the exact command or steps and the observed result. Separate checks that passed from checks marked **Not verified**.

## Verdict

End with one of two:

- `Block`: one or more `HIGH` findings remain. Do not ship until they are fixed.
- `Approve`: no `HIGH` findings remain. Any `MEDIUM` and `LOW` findings stay in the table as work to do.

`Approve` claims the coverage you reported, so never issue it for a domain you did not inspect.

## Change-scoped reviews

When `interface-review` resolved the scope from version control, it supplies the scope block, a status on every finding and the change-scoped format, which its `## Review output format` holds. Severity, ranking, the cap and the verdict are the ones above, and all four cover `Introduced` and `Regression` only.
