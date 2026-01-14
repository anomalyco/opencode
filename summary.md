# ShopOS Development Environment Summary

This document provides a detailed overview of the ShopOS (formerly OpenCode) development environment, specifically focusing on the recent rebranding activity and the underlying architecture of the CLI tool you are interacting with.

## 1. Context & Activity Overview

You are currently working in a **refactoring branch** (`refactor/shopos-branding`) of the ShopOS repository. The primary objective has been to rebrand the open-source "OpenCode" agent into a custom "ShopOS" internal tool.

### Recent Actions
- **Rebranding:** All user-facing references to "OpenCode" (CLI name, logos, system prompts, help text) have been updated to "ShopOS".
- **CLI Binary:** The executable commands have been changed from `opencode` to `shopos`.
- **System Identity:** The AI agent now identifies itself as "ShopOS" in conversations and directs users to `shopos.ai/docs`.

## 2. Architecture of the CLI Agent

The tool you are using is a sophisticated **Agentic CLI** built on a Client/Server architecture. It is designed to act as an autonomous pair programmer.

### Core Components

1.  **Client (CLI/TUI):**
    *   **Entry Point:** `src/index.ts` (now running as `shopos`).
    *   **UI:** A terminal user interface (TUI) built with `OpenTUI` (a custom library likely using Ink or similar logic) and `SolidJS` for reactivity.
    *   **Function:** Handles user input, rendering, and communicating with the server.

2.  **Server (The Brain):**
    *   **Session Management:** `src/session/index.ts` manages stateful conversations. Each "chat" is a persistent session stored locally.
    *   **Agent Loop:** The core logic runs a continuous loop: `User Input` -> `Reasoning` -> `Tool Selection` -> `Execution` -> `Observation` -> `Response`.
    *   **LLM Integration:** Connects to models (Claude, OpenAI, etc.) via the standard `ai` SDK.

3.  **The "Build" Process (What you saw in the terminal):**
    *   **Interactive REPL:** The CLI runs a Read-Eval-Print Loop.
    *   **Context:** It maintains a "Project Context" (files, git status, architecture).
    *   **Tools:** The agent has access to specific tools:
        *   `bash`: Execute shell commands.
        *   `edit`: Modify files.
        *   `read`: Read file contents.
        *   `manage`: Create/Update plans (Todo lists).
    *   **Session Names:** The system auto-generates names for sessions (e.g., `big-pickle`, `high-flyer`) to easily identify them in history.

## 3. How It Functions (The "Magic")

When you type a request like *"Build the store interface"*:

1.  **Ingestion:** The CLI packages your text + current file context + active terminal output.
2.  **Reasoning:** The LLM (e.g., Sonnet 3.5) analyzes the request against the `PRODUCT_KNOWLEDGE_BASE.md` (your long-term memory).
3.  **Planning:** It breaks the task down (e.g., "1. List products", "2. Create Component", "3. Update Route").
4.  **Execution:**
    *   It might run a `ls` or `grep` to find files.
    *   It calls `write_file` to generate code.
    *   It runs `bun build` to verify changes.
5.  **Feedback:** If a command fails, it reads the error, self-corrects, and retries.

## 4. Current Status

*   **Branch:** `refactor/shopos-branding`
*   **Build Status:** The dev server (`bun run dev`) is currently active.
*   **Next Steps:** The rebranding is technically complete in the codebase. The next logical step would be to build the binary (`bun run build`) or test the new `shopos` command to ensure the transition is seamless.

## 5. Key Files Modified

*   `packages/opencode/package.json`: Binary name change.
*   `packages/opencode/src/index.ts`: Runtime identity change.
*   `packages/opencode/src/cli/ui.ts`: ASCII Logo update.
*   `packages/opencode/src/session/prompt/anthropic.txt`: System personality update.
