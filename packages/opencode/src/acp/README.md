# ACP (Agent Client Protocol)

opencode can act as an [ACP](https://agentclientprotocol.com/) agent. Start it with:

```sh
opencode acp
```

## Question prompts

The `question` tool lets the agent ask the user multiple-choice questions. It is opt-in: the backing opencode server only registers the tool when `OPENCODE_ENABLE_QUESTION_TOOL=1` is set **before** the server starts:

```sh
OPENCODE_ENABLE_QUESTION_TOOL=1 opencode acp
```

Enable this only for ACP clients that support interactive question prompts.

Question support also requires the ACP client to advertise the following capability at initialize time:

```json
{
  "clientCapabilities": {
    "_meta": {
      "opencode/question": {
        "version": 1
      }
    }
  }
}
```

When enabled, opencode sends question requests over the ACP extension method `opencode/question`:

```json
{
  "requestId": "que_123",
  "sessionId": "ses_123",
  "questions": [
    {
      "header": "Build Agent",
      "question": "Start implementing now?",
      "options": [
        { "label": "Yes", "description": "Switch to build agent and start implementing" },
        { "label": "No", "description": "Stay in the current mode" }
      ]
    }
  ]
}
```

The client should return either:

```json
{ "answers": [["Yes"]] }
```

or:

```json
{ "rejected": true }
```

If a client connects without the `opencode/question` capability, or declines a question, opencode rejects the underlying question request so the agent does not block waiting for an answer that will never arrive.
