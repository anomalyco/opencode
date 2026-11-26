# skill

## GET /api/skill

Retrieve currently registered skills.

Returns: `{ location: Location.PublicRef; data: Skill.Info[] }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Skill.Info`: `{ id: string; name: string; description?: string; autoinvoke?: boolean; path: string; content: string }`
