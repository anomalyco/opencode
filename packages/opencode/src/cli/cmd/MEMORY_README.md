# OpenCode Memory System

A persistent memory management system that allows OpenCode to store and recall facts, preferences, context, and learnings across sessions.

## Features

- **4 Memory Types**: fact, preference, context, learning
- **Importance Scoring**: 1-10 scale for prioritizing memories
- **Tagging System**: Organize memories with custom tags
- **Keyword Search**: Find memories by content
- **Filtering**: Filter by type, sort by recency/importance/type
- **Statistics**: View memory store analytics

## Commands

### Add Memory

Interactively add a new memory:

```bash
opencode memory add
```

You'll be prompted for:

- Memory content
- Type (fact/preference/context/learning)
- Importance (1-10)
- Tags (optional, comma-separated)

**Example**:

```bash
$ opencode memory add
What would you like to remember? > User prefers 2-space indentation
Memory type > preference
Importance (1-10) > 8
Tags (comma-separated, optional) > coding, style
✅ Memory stored successfully (ID: mem_1730505600_abc123)
```

### List Memories

List all stored memories with optional filtering and sorting:

```bash
opencode memory list [--type <type>] [--limit <n>] [--sort <order>]
```

**Options**:

- `--type`: Filter by type (fact/preference/context/learning)
- `--limit`: Maximum number to show (default: 20)
- `--sort`: Sort order (recent/importance/type, default: recent)

**Examples**:

```bash
# List all memories (most recent first)
opencode memory list

# List only preferences
opencode memory list --type preference

# Show top 10 most important memories
opencode memory list --sort importance --limit 10

# List all learnings
opencode memory list --type learning
```

### Search Memories

Search memories by keyword:

```bash
opencode memory search <query> [--type <type>] [--limit <n>]
```

**Examples**:

```bash
# Find memories about indentation
opencode memory search "indentation"

# Search for coding preferences only
opencode memory search "prefer" --type preference

# Find recent learnings about React
opencode memory search "React" --type learning --limit 5
```

### Delete Memories

Delete a specific memory or clear all memories:

```bash
# Delete specific memory by ID
opencode memory delete <id>

# Delete all memories (with confirmation)
opencode memory delete all
```

**Examples**:

```bash
# Delete specific memory
opencode memory delete mem_1730505600_abc123

# Clear all memories
opencode memory delete all
? Delete all 42 memories? (y/N) > y
🗑️  Deleted all 42 memories
```

### View Statistics

Show memory store statistics:

```bash
opencode memory stats
```

**Output Example**:

```
📊 Memory Statistics

Total Memories: 127
Memory Size: 45.32 KB
Last Updated: 11/1/2025, 10:30:00 AM

By Type:
  Facts:        45 (35%)
  Preferences:  32 (25%)
  Context:      28 (22%)
  Learning:     22 (17%)

Average Importance: 6.2/10
Oldest Memory: 45d ago
Newest Memory: 2m ago
Unique Tags: 23

Top Tags: coding, style, project, react, typescript, preferences
```

## Memory Types

### Fact

General knowledge and factual information.

**Examples**:

- "The project uses Bun as the runtime"
- "API endpoint is https://api.example.com"
- "Database is PostgreSQL 15"

### Preference

User preferences and choices.

**Examples**:

- "User prefers functional components over class components"
- "Likes 2-space indentation"
- "Prefers single quotes for strings"

### Context

Contextual information about the project or session.

**Examples**:

- "Working on authentication feature"
- "Currently debugging login flow"
- "Project is a React SPA"

### Learning

Things learned during development.

**Examples**:

- "Learned: useEffect runs after render"
- "Found: Bun's fetch is faster than node-fetch"
- "Discovered: Vite HMR works better with .jsx extension"

## Storage Format

Memories are stored in `.opencode/memory.json`:

```json
{
  "memories": [
    {
      "id": "mem_1730505600_abc123",
      "content": "User prefers 2-space indentation",
      "embedding": [],
      "metadata": {
        "type": "preference",
        "timestamp": 1730505600000,
        "tags": ["coding", "style"],
        "importance": 8
      }
    }
  ],
  "version": "1.0.0",
  "lastUpdated": 1730505600000
}
```

## Future Enhancements

### Planned Features

- **Semantic Search**: Use embeddings for similarity-based search
- **Auto-Importance**: AI-suggested importance scores
- **Session Linking**: Link memories to specific sessions
- **Memory Decay**: Auto-reduce importance over time
- **Smart Suggestions**: Suggest relevant memories during sessions
- **Export/Import**: Backup and restore memories
- **Memory Graphs**: Visualize memory relationships

### Integration Ideas

- **Agent Context**: Automatically inject relevant memories into agent prompts
- **Session Memory**: Pull context from previous sessions
- **Learning Accumulation**: Track learnings across all sessions
- **Preference Application**: Auto-apply user preferences to code generation

## Use Cases

### 1. User Preferences

Store coding style preferences that persist across sessions:

```bash
opencode memory add
> User prefers async/await over .then() chains
> preference
> 9
> coding, async
```

### 2. Project Facts

Remember key project information:

```bash
opencode memory add
> API uses JWT authentication with 1-hour expiry
> fact
> 7
> api, auth
```

### 3. Learnings

Track discoveries and lessons learned:

```bash
opencode memory add
> Learned: Bun.file() is faster than fs.readFile for large files
> learning
> 8
> bun, performance
```

### 4. Context Tracking

Maintain awareness of ongoing work:

```bash
opencode memory add
> Currently refactoring user authentication module
> context
> 6
> current-work, auth
```

## Tips

1. **Be Specific**: Write clear, specific memories
2. **Use Tags**: Tag memories for easy filtering
3. **Set Importance**: Higher importance = more relevant
4. **Regular Cleanup**: Delete outdated memories
5. **Search Often**: Use search to find relevant context

## Examples

### Daily Workflow

```bash
# Morning: Check what you were working on
opencode memory search "currently" --type context

# During work: Store learnings
opencode memory add
> Learned: React 18 useEffect runs twice in strict mode
> learning
> 7
> react, hooks

# End of day: Update context
opencode memory delete mem_old_context
opencode memory add
> Currently: Implementing pagination for user list
> context
> 5
> current-work
```

### Code Review

```bash
# Check team preferences
opencode memory list --type preference

# Add new team convention
opencode memory add
> Team convention: Use named exports instead of default
> preference
> 9
> team, conventions
```

### Project Onboarding

```bash
# Store key facts about new project
opencode memory add
> Project uses Next.js 14 with App Router
> fact
> 8
> nextjs, project-setup

opencode memory add
> Deployment target is Vercel
> fact
> 7
> deployment, vercel
```

## Related Commands

- `opencode run` - Start OpenCode session (can inject memories)
- `opencode export` - Export session data (includes memory references)
- `opencode stats` - View overall statistics (includes memory count)

## Troubleshooting

### Memory file not found

Memories are created on first use. The `.opencode/memory.json` file is auto-created when you add your first memory.

### Large memory file

Use `opencode memory stats` to check file size. Delete old or unimportant memories to reduce size.

### Search returns no results

- Try different keywords
- Check if memories exist: `opencode memory list`
- Use broader search terms

## Configuration

No configuration required. The memory system works out of the box.

Optional future config in `opencode.json`:

```json
{
  "memory": {
    "maxSize": 10000,
    "autoCleanup": true,
    "semanticSearch": true
  }
}
```
