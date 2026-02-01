## Investigation: Repo manager entrypoint (Phase 16 UAT Test 1)

### Scope

- App UI entry points for repository manager dialog.
- Home empty state + recent projects state.
- Other possible entry points (session new view, sidebar).

### Findings

- The repository manager dialog is only reachable from `Home` via the "Manage repos" button.
- `Home` shows "Manage repos" in both the recent-projects header and the no-recent-projects empty state.
- There is no repository manager entry point in the session new view or sidebar; those surfaces only expose repo selection, add-local, and clone actions.

### Evidence

- `packages/app/src/pages/home.tsx` includes the "Manage repos" button in both states and opens `RepositoryManagerDialog`:
  - Recent projects header action row includes "Manage repos".
  - Empty state action row includes "Manage repos".
- `packages/app/src/components/session/session-new-view.tsx` shows `RepoSelector` (add local + clone) but no manage-repos action.
- No other references to `RepositoryManagerDialog` outside `Home`.

### Suspected root cause

- The repo manager entry point only exists on the Home page; if the user lands on a different empty state (e.g., new session view after opening a project or via auto-redirect), they will not see a "Manage repos" entry. This makes the UAT instructions (“open repository manager from empty state”) ambiguous or misleading depending on which empty state the user sees.

### Suggested fix direction

- Add a secondary entry point outside Home (e.g., sidebar project menu or session new view) or update UAT instructions to explicitly navigate to the Home page and use the "Manage repos" button there.
