# Workspace, Projects & VCS

Inspect the current location, projects, git worktrees, VCS status/diffs/branches, and references.

## `GET /api/location`
Get location. Resolve the requested location or the server default location.
- Returns: 200 `Location.PublicInfo`

## `POST /api/location/reload`
Reload configuration. Shut down and rebuild every loaded location. Pending permissions and forms are cancelled; running sessions continue with fresh services at the next step boundary. Emits location.shutdown for client recovery and responds once all replacement builds settle.
- Returns: 204 No Content

## `GET /api/project`
List projects. List known projects. Archived projects are excluded unless archived=true.
- Query: `archived?: "true" | "false"`
- Returns: 200 `Project[]`

## `PATCH /api/project/{projectID}`
Update project. Update the project canonical directory, display metadata, and workspace commands.
- Body: `{ canonical?: string; name?: string; icon?: Project.Icon; commands?: Project.Commands }`
- Returns: 200 `Project`

## `GET /api/reference`
List references. List references available in the requested location.
- Returns: 200 `{ location: Location.PublicRef; data: Reference.Info[] }`

## `GET /api/worktree`
List worktrees. Return the project's saved worktree inventory without loading configuration or running discovery.
- Query: `projectID: string`
- Returns: 200 `Worktree.List`

## `POST /api/worktree`
Create worktree. Load the project's canonical configuration, create a local worktree using its selected strategy, then run the project's setup script.
- Body: `Worktree.CreateInput`
- Returns: 200 `Worktree.Info`

## `DELETE /api/worktree`
Remove worktree. Load the project's canonical configuration and remove a saved worktree using its recorded strategy.
- Body: `Worktree.RemoveInput`
- Returns: 204 No Content

## `POST /api/worktree/refresh`
Refresh worktrees. Load the project's canonical configuration, discover worktrees across known checkout roots using all available strategies, and reconcile saved state.
- Body: `{ projectID: string }`
- Returns: 204 No Content

## `POST /api/vcs/init`
Initialize VCS repository. Initialize a repository using the selected VCS provider in a markerless project's directory and refresh its location services. Omitting provider defaults to git; built-in git and hg providers support initialization. An unknown provider returns 400; a registered provider without init returns 501.
- Query: `provider?: string`
- Returns: 204 No Content

## `GET /api/vcs`
VCS info. Get current and default branch information for the requested location.
- Returns: 200 `{ location: Location.PublicRef; data: Vcs.Info }`

## `GET /api/vcs/base`
VCS review base. Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.
- Returns: 200 `{ location: Location.PublicRef; data: Vcs.Base | null }`

## `GET /api/vcs/status`
VCS status. List uncommitted working-copy changes relative to the requested location.
- Returns: 200 `{ location: Location.PublicRef; data: Vcs.FileStatus[] }`

## `GET /api/vcs/branch`
VCS branches. List local and remote branches available at the requested location.
- Query: `search?: string`, `limit?: string`
- Returns: 200 `{ location: Location.PublicRef; data: Vcs.BranchList }`

## `GET /api/vcs/diff`
VCS diff. Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.
- Query: `mode: "working" | "branch" | "committed"`, `base?: string`, `context?: string`, `untracked?: "files" | "folders"`
- Returns: 200 `{ location: Location.PublicRef; data: FileDiff.Info[] }`

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
- `Location.PublicInfo`: `{ directory: string; project: { id, directory, canonical } }`
- `Location.PublicRef`: `{ directory: string }`
- `Project`: `{ id: string; canonical: string; vcs?: string; name?: string; icon?: Project.Icon; commands?: Project.Commands; time: Project.Time; sandboxes: string[] }`
- `Project.Commands`: `{ start?: string }`
- `Project.Icon`: `{ url?: string; override?: string; color?: string }`
- `Reference.Info`: `{ name: string; path: string; description?: string; hidden?: boolean; source: Reference.Source }`
- `Vcs.Base`: `{ name: string; ref: string; source: "reflog" | "default" }`
- `Vcs.BranchList`: `string[]`
- `Vcs.FileStatus`: `{ file: string; additions: number; deletions: number; status: "added" | "deleted" | "modified" }`
- `Vcs.Info`: `{ provider?: string; branch: Vcs.Branch }`
- `Worktree.CreateInput`: `{ projectID: string; from?: string; branch?: string; directory?: string; name?: string }`
- `Worktree.Info`: `{ directory: string }`
- `Worktree.List`: `Worktree.Directory[]`
- `Worktree.RemoveInput`: `{ projectID: string; directory: string; force: boolean }`
