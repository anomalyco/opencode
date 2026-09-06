# GitPigeon x TeamJules Integration Proposal

[GitPigeon](https://github.com/PeerPigeon/GitPigeon) provides encrypted, real-time, peer-to-peer synchronization for native Git repositories. It synchronizes both committed history and live, uncommitted working-tree changes (every 250ms).

Integrating GitPigeon into the **TeamJules Distributed Swarm** unlocks powerful capabilities for both human-agent interaction and agent-to-agent collaboration.

## 1. Live Agent Workspace Observation (Human-in-the-Loop)
**Current State:** TeamJules agents execute tasks in isolated Git worktrees. Human operators only see the final outcome when the agent commits and links a PR.
**GitPigeon Integration:** 
When a TeamJules worker checks out a worktree, it executes `git pigeon init` and securely publishes the `gitpigeon://sync/...` URL to the OpenCode UI. 
A developer can use GitPigeon locally to clone that URL. As the agent edits files, creates new modules, or refactors code, the developer sees the agent's live keystrokes and file changes reflected directly in their local IDE in real-time—without waiting for the agent to stage or commit.

## 2. Distributed Agent Pair-Programming
**Current State:** Multi-agent workflows are typically sequential. Agents hand off work by pushing commits, forcing a slow `push/pull` lifecycle.
**GitPigeon Integration:** 
Multiple TeamJules worker nodes can join the same GitPigeon mesh. 
- **Agent A (Architect)** can write scaffolding and interfaces on Worker 1.
- **Agent B (Implementer)** can concurrently write the function bodies on Worker 2.
GitPigeon synchronizes their live, uncommitted file changes across the nodes instantly. This enables true simultaneous agent-to-agent pair programming, side-stepping centralized Git server locks and latency.

## 3. Zero-Loss Worker Failover & Instant Handoff
**Current State:** If a TeamJules worker node crashes, is preempted, or loses its task lease before committing, the uncommitted work is destroyed.
**GitPigeon Integration:** 
By attaching a lightweight, persistent GitPigeon listener node to the active agent's worktree mesh, all file changes are backed up peer-to-peer as they happen. If the active worker crashes, the TeamJules dispatcher can assign the lease to a new worker. The new worker simply joins the mesh, instantly recovering the exact uncommitted state of the crashed agent with zero data loss.

## 4. Resolving Agent Divergence
**Current State:** Concurrent agent edits to the same files lead to messy Git merge conflicts that agents struggle to resolve.
**GitPigeon Integration:** 
GitPigeon automatically preserves local files and saves incoming concurrent edits under `.git/gitpigeon/live-conflicts/<device>/<path>`. A specialized TeamJules "Merge Agent" could be tasked with continuously monitoring this directory, analyzing divergent solution paths in real-time, and merging them smoothly before finalizing a commit.

---

## Advanced Capabilities (Phase 2)

### 5. Seamless Human Takeover & Co-Piloting
If an agent gets stuck in a logic loop or struggles with a complex architectural boundary, a human developer watching the mesh can simply start typing in their local IDE. The human's uncommitted edits sync instantly back to the agent's active worktree via GitPigeon. The developer can then instruct the agent to "continue from the code I just wrote." This blends human and AI execution seamlessly without any Git commit ceremony.

### 6. Real-Time Test Offloading (The "CI Sidecar")
Instead of the primary agent burning execution time running test suites and waiting for compilation, a secondary "Testing Worker" node sits passively on the GitPigeon mesh. The moment the agent saves a file on Node A, Node B instantly receives the uncommitted code and automatically kicks off the test suite in the background. Node B feeds test failures and lint errors directly back into the agent's context stream in real-time, creating an ultra-fast REPL loop.

### 7. Live Context & RAG Indexing
Currently, agent RAG (Retrieval-Augmented Generation) indexes rely on committed code. By putting a Background Indexer node on the GitPigeon mesh, OpenCode can continuously update vector embeddings and AST graphs based on the agent's *live, uncommitted* work. As the agent types, its context engine is always millisecond-accurate to its own immediate thought process.

### 8. Secure Agent Secret Distribution
GitPigeon explicitly supports a private-file channel for ignored secrets (`.env` files, config credentials). Rather than routing temporary API keys, cloud credentials, or secure configuration files through the central OpenCode task dispatcher, they can be securely distributed point-to-point from the coordinator directly to the isolated worker's worktree over the encrypted PeerPigeon mesh.

---

## Multitenant Scaling & Security (Profile A / B=32)

When running the `Kernelopti` backend in **Maximum Concurrency Multi-Agent Swarm (Profile A)**, the GPU processes up to 32 simultaneous agent streams ($B=32$). GitPigeon perfectly complements this high-density architecture:

### 9. Single-Daemon Sweep (Resource Efficiency)
GitPigeon operates via a **single, machine-wide background service**. It does not spawn a new heavy daemon for every repository. When a high-density TeamJules worker node hosts 32 active agent worktrees side-by-side, the single GitPigeon daemon sweeps all of them every 250ms, safely multiplexing the live file changes across the mesh with minimal CPU and memory overhead.

### 10. Cryptographic Tenant Isolation
Even though 32 distinct agents might share the same physical worker node and the same GPU inference batch, their workspaces remain strictly isolated on the wire. GitPigeon addresses every repository independently via uniquely encrypted capabilities (`gitpigeon://sync/REPOSITORY_ID#SECRET`). Tenant A's live code changes are cryptographically sealed from Tenant B, ensuring strict multi-tenant data boundaries across the P2P mesh.

### 11. LLM Network Offloading
At $B=32$, the inference backend is emitting 180–220+ tokens per second across different agent streams. Instead of forcing the `q8r_http_server` to stream massive file diffs back to remote clients over heavy HTTP/WebSocket pipelines, the inference agents write directly to their local Git worktrees. GitPigeon takes over the heavy lifting of synchronizing the dense file states across the network, freeing the LLM server to focus purely on high-throughput token serving.

---

### Implementation Blueprint for `distributed-tasks/src/worker.ts`

1. **Environment Setup:** Ensure the `git-pigeon` binary is installed on all TeamJules worker base images.
2. **Lifecycle Hook:** During task initialization, after `git clone` / `git worktree add`, execute:
   ```bash
   git pigeon init
   ```
3. **Secret Routing:** Capture the generated enrollment invite/secret from the daemon and route it back to the `AutomationQueue` or `SessionCore` so it can be securely displayed to authorized users in the OpenCode UI.
4. **Cleanup:** Ensure the worker executes `git pigeon unwatch` when the lease is gracefully completed to free up watcher resources.
