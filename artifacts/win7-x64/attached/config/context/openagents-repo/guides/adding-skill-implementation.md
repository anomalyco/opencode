<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: OpenCode Skill Implementation

**Prerequisites**: Load `adding-skill-basics.md` first  
**Purpose**: CLI implementation, registry, and testing for OpenCode skills

---

## CLI Implementation

### Basic Structure

```typescript
#!/usr/bin/env ts-node
// CLI implementation for {skill-name} skill

interface Args {
  command: string
  [key: string]: any
}

async function main() {
  const args = parseArgs()
  
  switch (args.command) {
    case 'command1':
      await handleCommand1(args)
      break
    case 'command2':
      await handleCommand2(args)
      break
    case 'help':
    default:
      showHelp()
  }
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  return {
    command: args[0] || 'help',
    ...parseOptions(args.slice(1))
  }
}

async function handleCommand1(args: Args) {
  console.log('Running command1...')
}

function showHelp() {
  console.log(`
{Skill Name}

Usage: npx ts-node scripts/skill-cli.ts <command> [options]

Commands:
  command1    Description
  command2    Description
  help        Show this help
`)
}

main().catch(console.error)
```

---

## Register in Registry (Optional)

### Add to Components

```json
{
  "skills": [
    {
      "id": "{skill-name}",
      "name": "Skill Name",
      "type": "skill",
      "path": ".opencode/skills/{skill-name}/SKILL.md",
      "description": "Brief description",
      "tags": ["tag1", "tag2"],
      "dependencies": []
    }
  ]
}
```

### Add to Profiles

```json
{
  "profiles": {
    "essential": {
      "components": [
        "skill:{skill-name}"
      ]
    }
  }
}
```

---

## Testing

### Test CLI Commands

```bash
# Test help
bash .opencode/skills/{skill-name}/router.sh help

# Test commands
bash .opencode/skills/{skill-name}/router.sh command1 --option value

# Test with npx
npx ts-node .opencode/skills/{skill-name}/scripts/skill-cli.ts help
```

### Test OpenCode Integration

1. Call skill via OpenCode
2. Verify event hooks fire correctly
3. Check conversation history for skill content
4. Verify output enhancement works

---

## Best Practices

### Keep Skills Focused
- ✅ Task management skill → Tracks tasks
- ❌ Task management + code generation + testing → Too broad

### Clear Documentation
- Provide usage examples
- Document all commands
- Include expected outputs

### Error Handling
- Handle missing arguments gracefully
- Provide helpful error messages
- Validate inputs before processing

### Performance
- Use efficient algorithms
- Cache when appropriate
- Avoid unnecessary file operations

---

## Checklist

- [ ] `.opencode/skills/{skill-name}/SKILL.md` created
- [ ] `.opencode/skills/{skill-name}/router.sh` created (if CLI-based)
- [ ] Router script is executable (`chmod +x`)
- [ ] Registry updated (if needed)
- [ ] Profile updated (if needed)
- [ ] All commands tested
- [ ] Documentation complete

---

## Related

- `adding-skill-basics.md` - Directory and SKILL.md setup
- `adding-skill-example.md` - Complete example
- `creating-skills.md` - Claude Code Skills
- `plugins/context/capabilities/events_skills.md` - Skills Plugin
