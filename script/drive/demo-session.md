# Demo session

`demo-session.ts` starts an isolated OpenCode server for the debug bar's Demo controls. Its simulated model answers
each `[demo:<action> <speed>×]` prompt with a scripted reply. Shell commands, patches, file reads and the background
subagent run for real inside the throwaway project, so the app renders them through the normal event path.

## Run

Use an `opencode-drive` installation on the module path and a dependency-installed checkout:

```sh
DEMO_STATE=/tmp/demo-session.json opencode-drive run script/drive/demo-session.ts
```

The script prints the session it created. `DEMO_STATE` optionally receives the server URL, its password and that
session ID, for a proxy or a client that opens it directly. Connect a dev or Beta build of the app to that server,
open the session, toggle the debug bar and press DEMO.

| Control     | What the session does                                                    |
| ----------- | ------------------------------------------------------------------------ |
| Paragraph   | Streams reasoning, then a paragraph                                      |
| Code block  | Streams a fenced TypeScript block line by line                           |
| Shell       | Runs a real shell command whose output grows                             |
| Patch       | Applies a real one-line patch, alternating between two values            |
| Long turn   | Thinks for a few seconds before answering                                |
| Finish turn | Interrupts the running turn                                              |
| Message     | Sends a user message that gets a short reply                             |
| Steer       | Sends a prompt that steers a running turn                                |
| Burst       | Reads five files in parallel, then streams one-character text deltas     |
| Queue       | Queues a prompt behind the running turn                                  |
| Subagent    | Starts a background subagent that reports back when it finishes          |
| Bg shell    | Starts a real background shell that keeps printing for about ten seconds |
| Auto-play   | Loops a scripted mix of the above, including a steer and a queued prompt |

Anything typed into the composer gets a random 5–10 second turn seeded by the conversation: reasoning, prose,
lists and code between one to three real shell builds, often a patch and parallel reads, sometimes a background
subagent or shell, then a summary. Typed text containing `short` or `code` gets those replies instead. Typed prompts
use the speed of the latest Demo control. Routing a session on the simulated model opens the debug bar and its
Demo panel.

Speed scales the model's streaming delays and the shell scripts' pacing from 0.25× to 2×.
