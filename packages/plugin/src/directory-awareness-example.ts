import { DirectoryAwarenessPlugin } from "./directory-awareness"

// Example usage of the DirectoryAwarenessPlugin
// This demonstrates how the plugin solves the directory confusion issue

export const ExampleUsage = DirectoryAwarenessPlugin

/*
The Directory Awareness Plugin solves the common issue where agents get confused 
about their working directory in monorepos.

Problem:
- Agent runs: `cd packages/web && ls`
- Agent thinks they're in packages/web for subsequent commands
- But bash tool always uses project root as cwd

Solution:
- Plugin tracks "virtual" working directory per session
- Intercepts `cd` commands and updates virtual directory
- Modifies bash execution to use virtual directory as cwd
- Provides `pwd` tool to show current virtual directory
- Adds periodic reminders about current directory

Usage:
1. Agent runs `cd packages/web && npm run dev`
2. Plugin detects `cd packages/web` and updates virtual directory
3. Plugin modifies bash command to `npm run dev` with cwd=`/project/packages/web`
4. Agent can use `pwd` tool to see current virtual directory
5. Plugin shows reminders: "💡 Directory Reminder: You are in virtual directory 'packages/web'"

Safety Features:
- Prevents leaving project boundaries with path validation
- Falls back to project root if invalid path detected
- Resolves relative paths correctly
*/
