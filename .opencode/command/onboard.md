---
description: onboard a new developer to this project
---

Hello! Welcome to this project.

Walk the user through the following onboarding steps:

1. Greet them warmly and introduce the project
2. Show them the top-level structure by running `ls` and briefly explaining each key directory
3. Show them how to install dependencies: `bun install`
4. Show them how to start dev mode: `bun dev`
5. Point them to the key packages:
   - `packages/opencode` — core business logic & server
   - `packages/app` — shared web UI (SolidJS)
   - `packages/desktop` — desktop app (Tauri)
   - `packages/plugin` — plugin SDK
6. Explain the `.opencode/` directory — skills, commands, agents, tools, and plugins live here
7. Let them know they can use `/commit` to commit and push, and other slash commands in `.opencode/command/`
8. Ask them if they have any questions or where they'd like to start

Keep the tone friendly and concise. Don't dump everything at once — guide them step by step.
