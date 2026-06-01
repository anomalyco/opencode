# The Game Plan: Deepagent Architecture Implementation Plan

This is our roadmap for upgrading the **opencode** CLI monorepo. We've combined the monorepo integration plan and the low-level recursive LLM (RLM) engine plan into a single, cohesive document written in plain, friendly English.

---

## What We Discovered (The "Why" Behind the Upgrades)

When we looked closely at the documentation and research papers, we realized our initial plan had a few blind spots. Here is what we need to fix:

### 1. Tool Search (How Claude finds the right tool without getting overwhelmed)
*   **Context Bloat is expensive:** If we load all 100+ tools for Claude at the start, it costs a ton of money and slows down response times. We will use a "just-in-time" approach where Claude only loads tools when it actually needs them.
*   **The Golden Rules of Tool Search:**
    *   *The "At Least One" rule:* Claude needs to see at least one tool right away (usually the search tool itself). We can't hide ("defer") all of them.
    *   *No Examples:* If we tell Claude to search for tools, we cannot include usage examples in the tool definitions—the API will throw an error. We will automatically strip them out.
    *   *Custom Searches:* If we want to build a smart search (like using vector embeddings to find tools), we have a clean way to do it. The client will return search results in a special format called a `tool_reference`, and Claude's backend will automatically expand it.
    *   *Streaming:* As Claude types its search query, we will stream the search results back immediately handling `server_tool_use` events.

### 2. RLM Sandbox (Keeping code execution safe and stable)
*   **Ditch the custom watchdogs:** Our old plan suggested writing custom timers to stop infinite loops in Python code. That is super fragile and hard to make work on Windows.
*   **The Better Way:** We will use a separate IPython subprocess kernel. It isolates the namespaces and shuts down long-running cells automatically without crashing our main system.
*   **Traject Visualizer:** We will save all runs into a `.jsonl` log folder. We will set up the Next.js visualizer (which runs on port 3001) so developers can click through the logs and see exactly what code the agent ran and what variables it used.
*   **Multi-Environment support:** We will support `local` (exec-based), `ipython`, `docker`, and isolated cloud REPLs (`modal`, `e2b`, `daytona`).

### 3. Testing and Metrics (Making sure the agent actually works)
*   **Strict Consistency (`pass^k`):** Instead of checking if the agent gets the right answer *at least once* out of 5 tries, we will measure if it gets it right *every single time*. This is crucial for business-critical tasks.
*   **Role-Based Security:** Before the agent runs any tool, our code will check if the active user has the permission to run it. No bypassing access control.
*   **7-Layer Instrumentation:** Track latency, cost, and safety alerts at every level (MCP, tools, retrieval, agent, session, plugins, and LLM).

---

## Detailed Step-by-Step Execution Plan

### Phase 1: Tool Search Implementation (`packages/{llm, tool, session, mcp}`)

1.  **Add protocol shapes:** Teach our TypeScript client how to understand tool search result blocks and reference blocks.
2.  **Hide definitions by default:** Add a `defer_loading` setting. If it's on, don't send the tool's schema to Claude until Claude asks for it.
3.  **Validate constraints:** Double check that we don't accidentally hide the search tool, and automatically strip out examples when search is active.
4.  **Wire up streaming:** Make sure that as Claude types its search query, we stream the search results back immediately.

### Phase 2: Building the Python RLM Server (`packages/rlm`)

1.  **Set up the environment:** Use `uv` to configure a Python 3.12 workspace and install the `rlms` package.
2.  **Configure IPython subprocesses:** Set up IPython subprocesses to run code chunks safely with namespace isolation and timeouts.
3.  **Set up visualizer logs:** Configure a logger to save trajectory logs to `./logs`. Make sure the Next.js visualizer dashboard is ready to launch.

### Phase 3: Monitoring & Metrics Layer (`packages/opencode/src/metrics`)

1.  **Add a metrics database:** Create a fast memory buffer and SQLite store to track running cost, token usage, and latency.
2.  **Instrument the code:** Put check points in the code to log every LLM call, calculate `pass^k` consistency, and block tool calls if the user doesn't have permissions.
3.  **TUI dashboard alerts:** Show cost and alerts directly on the console UI, and automatically switch to backup models if latency spikes.

---

## How We Will Verify It Works

*   Run `bun typecheck` to make sure TypeScript has no syntax bugs.
*   Run Python tests (`pytest`) inside the `rlm` folder.
*   Verify that Claude can search for tools, load only the ones it needs, and run them safely without crashing.
*   Open the visualizer on `localhost:3001` and verify we can see the execution graphs.
