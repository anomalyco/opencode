# project

## GET /api/project

List known projects. Archived projects are excluded unless archived=true.

Parameters:
- `archived?: "true" | "false"` Set to true to include archived projects.

Returns: `Project[]`

## PATCH /api/project/{projectID}

Update the project canonical directory, display metadata, and workspace commands.

Body:
- `canonical?: string`
- `name?: string`
- `icon?: Project.Icon`
- `commands?: Project.Commands`

Returns: `Project`

## Types

- `Project`: `{ id: string; canonical: string; vcs?: string; name?: string; icon?: Project.Icon; commands?: Project.Commands; time: Project.Time; sandboxes: string[] }`
- `Project.Commands`: `{ start?: string }`
- `Project.Icon`: `{ url?: string; override?: string; color?: string }`
- `Project.Time`: `{ created: number; updated: number; active: number; archived?: number }`
