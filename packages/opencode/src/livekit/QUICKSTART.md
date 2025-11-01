# LiveKit Quick Start Guide

Get started with OpenCode LiveKit integration in 5 minutes.

## Prerequisites

- OpenCode installed
- LiveKit server credentials (or local setup)
- Microphone access (for transcription)

## Step 1: Get LiveKit Credentials

### Option A: LiveKit Cloud (Easiest)

1. Go to [cloud.livekit.io](https://cloud.livekit.io/)
2. Create a free account
3. Create a new project
4. Copy your credentials

### Option B: Local Development

```bash
# Run LiveKit locally with Docker
docker run --rm -p 7880:7880 \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server \
  --dev
```

Credentials:

- URL: `ws://localhost:7880`
- Key: `devkey`
- Secret: `secret`

## Step 2: Configure OpenCode

```bash
# Set environment variables
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"

# Or for local development
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="devkey"
export LIVEKIT_API_SECRET="secret"
```

## Step 3: Start an AI Agent

```bash
# Start agent (will prompt for room name)
opencode room agent start

# Or specify room name
opencode room agent start --room my-first-room
```

You should see:

```
🤖 Starting OpenCode Room Agent

? Which room should the agent join? › my-first-room

🏠 Room: my-first-room
🤖 Agent: opencode-assistant
📝 Transcription: ✓
📋 Notes: ✓
✅ Todos: ✓

Connecting to room...
✅ Agent started successfully!

The agent is now listening in the room.
Press Ctrl+C to stop the agent.
```

## Step 4: Test It Out

### Using Browser

1. Open [LiveKit Meet](https://meet.livekit.io/)
2. Enter your server URL
3. Generate a token (or use the test page)
4. Join the same room: `my-first-room`
5. Start speaking!

The OpenCode agent will:

- Transcribe everything you say
- Generate notes for important phrases
- Extract todos from action items

### Example Conversation

Try saying:

```
"This is an important decision - we need to use TypeScript for the project."
→ Creates note: "Decision: Use TypeScript"

"We should finish the documentation by Friday."
→ Creates todo: "finish the documentation by Friday" (Medium priority)

"Remember to deploy the changes asap!"
→ Creates todo: "deploy the changes" (High priority - contains "asap")
```

## Step 5: View Results

The agent logs everything to console:

```
[local]: This is an important decision
Note created: Decision noted (type: decision)

[local]: We should finish the documentation
Todo created: finish the documentation (priority: medium)
```

## Common Tasks

### Stop the Agent

```bash
# Press Ctrl+C in the terminal
^C
Stopping agent...
Agent stopped.
```

### Configure Agent Capabilities

```bash
# Only transcription, no notes/todos
opencode room agent start --transcribe --no-notes --no-todos

# Only todos
opencode room agent start --no-transcribe --no-notes --todos
```

### Use Different Room

```bash
opencode room agent start --room dev-team-standup
```

### Change Agent Name

```bash
opencode room agent start --name alice-assistant
```

## Next Steps

### 1. View Conversation History

```typescript
// In your code
const history = agent.getConversationHistory()
console.log(history)
```

### 2. Generate Meeting Summary

```typescript
const summary = await agent.summarizeConversation()
console.log("Summary:", summary)
```

### 3. Get Notes and Todos

```typescript
const notes = await agent.generateNotes()
const todos = await agent.extractTodos()

console.log("Notes:", notes)
console.log("Todos:", todos)
```

### 4. Share Custom Tools

```typescript
import { createToolBridge } from "opencode/livekit"

const bridge = createToolBridge(roomManager)

await bridge.exposeTools([
  {
    name: 'custom_tool',
    description: 'My custom tool',
    parameters: [...],
    execute: async (params) => {
      // Your logic
    }
  }
])
```

## Troubleshooting

### "LiveKit configuration missing!"

Set your credentials:

```bash
export LIVEKIT_URL="wss://your-server.livekit.cloud"
export LIVEKIT_API_KEY="your-key"
export LIVEKIT_API_SECRET="your-secret"
```

### "Failed to connect to LiveKit room"

1. Check server URL is correct
2. Verify API key and secret
3. Test with LiveKit Meet first

### No transcription

1. Allow microphone access in browser
2. Check `--transcribe` flag is set
3. Try Chrome/Edge (best Web Speech API support)

### Agent crashes

Check logs for errors:

```bash
opencode room agent start --print-logs
```

## Examples

### Team Standup

```bash
opencode room agent start \
  --room daily-standup \
  --name standup-bot \
  --transcribe \
  --notes \
  --todos
```

The agent will:

- Transcribe the standup
- Note important decisions
- Extract action items
- Assign todos automatically

### Voice Coding

```bash
opencode room agent start \
  --room coding-session \
  --name code-assistant
```

Speak your thoughts:

- "Important: Use dependency injection pattern"
- "Need to refactor the auth module"
- "Remember to add unit tests"

### Interview Notes

```bash
opencode room agent start \
  --room interview \
  --name interview-assistant \
  --notes
```

Perfect for:

- Recording interview highlights
- Extracting key points
- Generating summaries

## Tips

### 1. Use Descriptive Phrases

The agent detects:

- "important"
- "remember"
- "note that"
- "decision"
- "need to"
- "should"

### 2. Be Explicit About Priority

Say:

- "urgent" or "asap" → High priority
- "soon" or "important" → Medium priority
- Everything else → Low priority

### 3. Mention Names for Assignment

Say:

- "Alice needs to review the code" → Assigned to Alice
- "Bob should update docs" → Assigned to Bob

### 4. Use Hashtags for Tags

Say:

- "This is important #backend #api"
- Agent extracts tags: ["backend", "api"]

## Full Example Session

```bash
# Terminal 1: Start agent
$ opencode room agent start --room project-planning

🤖 Starting OpenCode Room Agent
🏠 Room: project-planning
📝 Transcription: ✓
📋 Notes: ✓
✅ Todos: ✓

Connecting to room...
✅ Agent started successfully!

# Terminal 2: Join room via browser or another client
# Start speaking...

[alice]: Important decision - we're using React for the frontend
Note created: Decision: Using React for frontend

[bob]: We need to finish the API documentation asap
Todo created: finish the API documentation (priority: high)

[alice]: Remember to deploy by end of week
Todo created: deploy by end of week (priority: medium)

# Press Ctrl+C to stop
^C
Stopping agent...
Agent stopped.

# View results
$ opencode memory list --type note
📋 Recent notes from conversation...

$ opencode memory list --type todo
✅ Action items extracted...
```

## Resources

- [Full Documentation](./README.md)
- [Architecture Details](./ARCHITECTURE.md)
- [API Reference](./types.ts)
- [LiveKit Docs](https://docs.livekit.io/)

## Support

- File issues on GitHub
- Check troubleshooting guide
- Ask in community discussions

---

**You're ready to use LiveKit with OpenCode!** 🎉

Start your first agent and begin collaborating with voice.
