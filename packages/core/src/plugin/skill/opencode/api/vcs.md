# vcs

## POST /api/vcs/init

Initialize a repository using the selected VCS provider in a markerless project's directory and refresh its location services. Omitting provider defaults to git; built-in git and hg providers support initialization. An unknown provider returns 400; a registered provider without init returns 501.

Parameters:
- `provider?: string` VCS provider to initialize. Defaults to git.

Returns: nothing

## GET /api/vcs

Get current and default branch information for the requested location.

Returns: `{ location: Location.PublicRef; data: Vcs.Info }`

## GET /api/vcs/base

Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.

Returns: `{ location: Location.PublicRef; data: Vcs.Base }`

## GET /api/vcs/status

List uncommitted working-copy changes relative to the requested location.

Returns: `{ location: Location.PublicRef; data: Vcs.FileStatus[] }`

## GET /api/vcs/branch

List local and remote branches available at the requested location.

Parameters:
- `search?: string`
- `limit?: string`

Returns: `{ location: Location.PublicRef; data: Vcs.BranchList }`

## GET /api/vcs/diff

Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.

Parameters:
- `mode: "working" | "branch" | "committed"`
- `base?: string`
- `context?: string`
- `untracked?: "files" | "folders"`

Returns: `{ location: Location.PublicRef; data: FileDiff.Info[] }`

## Types

- `FileDiff.Info`: `{ file: string; patch: string; additions: number; deletions: number; status: "added" | "deleted" | "modified"; more?: true }`
- `Location.PublicRef`: `{ directory: string }`
- `Vcs.Base`: `{ name: string; ref: string; source: "reflog" | "default" }`
- `Vcs.Branch`: `{ current?: string; default?: string }`
- `Vcs.BranchList`: `string[]`
- `Vcs.FileStatus`: `{ file: string; additions: number; deletions: number; status: "added" | "deleted" | "modified" }`
- `Vcs.Info`: `{ provider?: string; branch: Vcs.Branch }`
