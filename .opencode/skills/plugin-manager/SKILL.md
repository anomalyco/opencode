# Plugin Manager Agent Skill

## Purpose
Discovers, validates, installs, and manages OpenCode plugins and MCP servers. Provides a unified interface for plugin lifecycle management with security review.

## Capabilities
- Discover plugins from registries
- Validate plugin security and compatibility
- Install/uninstall plugins with rollback
- List installed plugins with status
- Check for plugin updates
- Security scan before installation

## Configuration
```json
{
  "name": "plugin-manager",
  "category": "system",
  "priority": "high",
  "enabled": true,
  "triggers": ["install plugin", "remove plugin", "list plugins", "update plugin", "mcp server"],
  "securityReviewRequired": true
}
```

## Usage
```
/oc plugin install --name <plugin-name> --security-review
/oc plugin list --status all
/oc plugin update --all
/oc mcp add --name <server-name> --command <cmd>
```

## Contribution Target
- **OpenCode**: Submit as a built-in system skill
- **OpenRouter**: Use to manage OpenRouter model plugins
