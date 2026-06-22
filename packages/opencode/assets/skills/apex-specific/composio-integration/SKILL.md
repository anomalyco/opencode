---
name: composio-integration
description: Use when no specialized APEX tool handles an external-system integration
---

# Composio Integration Skill

Use this skill when a request requires interaction with an external system (email, calendar, CRM, etc.) and no APEX specialist tool covers it.

## Discovery Sequence

1. **ManageConnections** — check authentication/connected systems.
2. **SearchTools** — discover candidate tools from intent.
3. **FindTools** with `include_args=True` — inspect exact parameters.
4. **ExecuteTool** — run the chosen tool.

## Constraints

- Only use Composio when no APEX native tool handles the action.
- Do not mention Composio unless it is needed.
- Handle missing `COMPOSIO_API_KEY` gracefully by telling the user to set it.
