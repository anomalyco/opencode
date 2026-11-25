# worktree

## GET /api/worktree

Return the project's saved worktree inventory without loading configuration or running discovery.

Parameters:
- `projectID: string`

Returns: `Worktree.List`

## POST /api/worktree

Load the project's canonical configuration, create a local worktree using its selected strategy, then run the project's setup script.

Body:
- `projectID: string`
- `from?: string`
- `branch?: string`
- `directory?: string`
- `name?: string`

Returns: `Worktree.Info`

## DELETE /api/worktree

Load the project's canonical configuration and remove a saved worktree using its recorded strategy.

Body:
- `projectID: string`
- `directory: string`
- `force: boolean`

Returns: nothing

## POST /api/worktree/refresh

Load the project's canonical configuration, discover worktrees across known checkout roots using all available strategies, and reconcile saved state.

Body:
- `projectID: string`

Returns: nothing

## Types

- `Worktree.Directory`: `{ directory: string; strategy?: string }`
- `Worktree.Info`: `{ directory: string }`
- `Worktree.List`: `Worktree.Directory[]`
