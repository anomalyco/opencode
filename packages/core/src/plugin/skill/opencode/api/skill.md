# skill

## GET /api/skill

Retrieve currently registered skills.

Returns: `{ location: Location.PublicRef; data: Skill.Info[] }`

## GET /api/skill/{skillID}/content

Read a skill's SKILL.md body, loading it first when it loads on demand, such as an MCP skill fetched from its server. Fails with 502 when it can't be loaded.

Returns: `{ location: Location.PublicRef; data: Skill.Content }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Skill.Content`: `{ content: string }`
- `Skill.Info`: `{ id: string; name: string; description?: string; autoinvoke?: boolean; path: string; content: string }`
