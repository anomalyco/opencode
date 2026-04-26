# Prompt & Context (Ingestion & The Start of the Loop)

## 1. System Prompt Composition

The final system prompt that the model evaluates is dynamically composed of multiple artifacts concatenated together at runtime. This execution sequence is explicitly governed by the internal array construction logic (specifically documented within the codebase at [`src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts) and [`src/session/llm.ts`](../../packages/opencode/src/session/llm.ts)).

```mermaid
flowchart TD
    Start[User Prompt] --> Check{Has Agent Prompt?}
    Check -- No --> Base[1a. Inject Base Provider Persona]
    Check -- Yes --> Agent[1b. Inject Agent-Specific Prompt]
    Base --> Env[2. Inject Environment Context]
    Agent --> Env
    Env --> Skills[3. Inject Skills Registry]
    Skills --> Files[4. Inject File-Based Instructions]
    Files --> Reminders[5. Append Mode Reminders to Last User Message]
    Reminders --> LLM[Dispatch to Vercel AI SDK]
```

### The System Prompt Composition

#### 1a. Base Provider Persona

A highly-optimized, model-specific base persona (e.g., `beast.txt`, `gemini.txt`). Defines the fundamental operational rules, safety boundaries, and tool utilization conventions. These personas are continuously tuned to combat the specific quirks, laziness, and failure modes of each vendor's foundation model.

**Example: Gemini Persona (Base)**

```text
You are opencode, an interactive CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.

# Core Mandates

- **Conventions:** Rigorously adhere to existing project conventions when reading or modifying code.
- **Libraries/Frameworks:** NEVER assume a library/framework is available or appropriate. Verify its established usage...
- **Style & Structure:** Mimic the style (formatting, naming), structure, framework choices, typing, and architectural patterns...
...

# Primary Workflows

## Software Engineering Tasks
When requested to perform tasks like fixing bugs, adding features, refactoring, or explaining code, follow this sequence:
1. **Understand:** Think about the user's request and the relevant codebase context. Use 'grep' and 'glob' search tools extensively...
2. **Plan:** Build a coherent and grounded plan for how you intend to resolve the user's task...
3. **Implement:** Use the available tools to act on the plan, strictly adhering to the project's established conventions...
...

## New Applications
**Goal:** Autonomously implement and deliver a visually appealing, substantially complete, and functional prototype. Utilize all tools at your disposal...
...

# Operational Guidelines

## Tone and Style (CLI Interaction)
- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment.
- **Minimal Output:** Aim for fewer than 3 lines of text output...
...

## Security and Safety Rules
- **Explain Critical Commands:** Before executing commands with 'bash' that modify the file system, codebase, or system state, you *must* provide a brief explanation...
...

## Tool Usage
- **File Paths:** Always use absolute paths when referring to files with tools like 'read' or 'write'...
...

# Final Reminder
Your core function is efficient and safe assistance. Balance extreme conciseness with the crucial need for clarity, especially regarding safety and potential system modifications. Always prioritize user control and project conventions. Never make assumptions about the contents of files; instead use 'read' to ensure you aren't making broad assumptions. Finally, you are an agent - please keep going until the user's query is completely resolved.
```

#### 1b. Agent-Specific Prompt

A tailored system prompt completely overriding (not supplementing) the base persona for a specific subagent (e.g., the `@explore` agent, the `@compaction` agent).

**Example: @compaction Agent Prompt**

```text
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the older conversation history.
The most recent turns may be preserved verbatim outside your summary, so focus on information that would still be needed to continue the work with that recent context available.
```

#### 2. Environment Context

A dynamically injected string indicating the runtime model, followed by an `<env>` block containing the working directory, workspace root, OS platform, and timestamp.

**Example: Windows Git Environment**

```text
You are powered by the model named gemini-3.1-pro-preview. The exact model ID is google/gemini-3.1-pro-preview
Here is some useful information about the environment you are running in:
<env>
  Working directory: E:\projects_large\opencode
  Workspace root folder: E:\projects_large\opencode
  Is directory a git repo: yes
  Platform: win32
  Today's date: Sat Apr 25 2026
</env>
```

#### 3. Skills Registry

A verbose registry of available "Skills" (custom programmatic workflows) injected if the agent possesses the required permissions.

**Example: Populated Registry**

```text
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.

Available skills:

- git-rebase: Handles conflict resolution workflows for git rebases.
- react-component: Scaffolds a new React component with tests and stories.
```

#### 4. File-Based Instructions

Automatically scraped context from local repositories (e.g., `AGENTS.md`, `CLAUDE.md`) and user-configured global instruction files.

**Example: Project-Level (AGENTS.md)**

```text
Instructions from: E:\projects_large\opencode\AGENTS.md

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
```

#### 5. Mode Reminders

State-based XML blocks appended to the **last User Message** (not the system prompt). Placing these at the end of the user message ensures high attention weighting. For example, appending a strict read-only constraint when the user requests a "plan".

**Example: Plan Mode (Read-Only)**

```text
<system-reminder>

# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files - commands may ONLY read/inspect.
</system-reminder>
```

---

## 2. Filesystem-as-State

Opencode operates on a foundational paradigm where "Filesystem-as-State" governs the agent's memory. Rather than relying heavily on internal, serialized conversation history (chat logs) to remember context like standard CLIs, Opencode dynamically injects repository state, local configuration files, and active workspace data into the prompt at runtime.

The agent always knows the _current_ state of the project, even if the user manually edited files in their IDE while the agent was running. This eliminates hallucinations caused by outdated chat logs where the agent assumes a file looks a certain way because of a previous response.

---

### Sandboxed Context Scoping

To achieve safe orchestration across multiple projects, Opencode explicitly abandons standard Node.js global singletons in favor of a strictly sandboxed context model powered by the Effect runtime. As implemented in [`src/effect/instance-state.ts`](../../packages/opencode/src/effect/instance-state.ts), services are encapsulated within an `InstanceState` wrapper keyed by the active workspace directory. (For more details, see [State & Memory Management](./05_state-and-memory.md)).

---

## 3. Bridging the Vercel AI SDK

While the Vercel AI SDK expects a highly simplistic payload (e.g., `{ role: "user", content: "hello" }`), Opencode utilizes a much richer internal `MessageV2` format. This event-sourced format is stored in SQLite and handles complex domain abstractions like MCP resources, background sub-agent logs, and synthetic context.

To bridge this gap, the `toModelMessagesEffect` pipeline executes right before making the API call. This translation process "dumbs down" Opencode's rich internal state into the simple array format required by the AI SDK.

### Message Translation

- **User Messages:** Translates raw user text inputs and resolves embedded `FilePart` URIs.
- **MCP Resources:** If a user message includes an MCP resource, it has already been eagerly resolved during the initial prompt ingestion phase (in `src/session/prompt.ts`) and stored in the database as a synthetic text block. `toModelMessagesEffect` simply translates this pre-fetched block into a standard user message.
- **Assistant Messages:** Maps prior AI responses from the database. It parses internal `<reasoning>` blocks and translates them into native SDK reasoning formats where supported.
- **Tool Artifacts:** Translates internal `ToolPart` objects into standardized `tool_call` and `tool_result` payloads.

### The "Media in Tool Results" Workaround

A critical fallback exists for SDK compatibility:

- **Challenge**: While official providers like `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@ai-sdk/google` natively handle rich media within `tool_result` objects, generic **OpenAI-compatible APIs** (e.g., local LLM routers) often enforce strict schemas that only allow text strings. However, certain tools return rich media (e.g., a browser snapshot).
- **Resolution**: Opencode dynamically evaluates the target model provider. If the target model utilizes a generic provider that does not support media within tool results, Opencode artificially extracts the base64 media data, strips it from the `tool_result`, and appends it as a subsequent `user` message block. This circumvents API schema validation errors while ensuring the model maintains visual context.

```mermaid
flowchart TD
    subgraph opencode_state [Opencode State]
        DB[(SQLite MessageV2)]
        MCP[MCP Resource Fetcher]
    end

    subgraph prompt_ts ["prompt.ts (Ingestion)"]
        P2{Is MCP Resource?}
        P3[Fetch URI & Inject Synthetic Text Part]
        P2 -- Yes --> P3
        P3 --> DB
    end

    subgraph pipeline ["toModelMessagesEffect Pipeline"]
        P1[Parse MessageV2]

        P4{Is Tool Artifact?}
        P5[Map to tool_call/tool_result]

        P6{Model Supports Media in Tool Results?}
        P7[Strip Base64 Media]
        P8[Append Media as Synthetic User Message]
    end

    subgraph sdk [Vercel AI SDK]
        V1["{role: 'user', content: ...}"]
        V2["{role: 'assistant', tool_calls: ...}"]
    end

    DB --> P1
    P1 --> P4
    P4 -- Yes --> P5

    P5 --> P6
    P6 -- No --> P7
    P7 -->|Media| P8
    P8 --> V1
    P7 -->|Text Output| V2

    P6 -- Yes --> V2
    P4 -- No --> V1
```

---

## 4. Source Code Reference

The mechanics discussed in this document are primarily implemented in the following files:

- **[`src/session/prompt.ts`](../../packages/opencode/src/session/prompt.ts)**: The core prompt execution pipeline that dynamically injects the artifacts, system contexts, and instructions discussed in Section 1 before dispatching the payload to the LLM.
- **[`src/session/llm.ts`](../../packages/opencode/src/session/llm.ts)**: Manages the actual dispatch to the model provider, applying the constructed prompt and tools.
- **[`src/session/instruction.ts`](../../packages/opencode/src/session/instruction.ts)**: Handles parsing and resolving local instruction files (like `AGENTS.md`) to inject into the system prompt.
- **[`src/session/message-v2.ts`](../../packages/opencode/src/session/message-v2.ts)**: Contains the `toModelMessagesEffect` mapping logic (Section 3) that bridges Opencode's rich SQLite schema to the Vercel AI SDK, including the rich-media stripping workaround.
- **[`src/effect/instance-state.ts`](../../packages/opencode/src/effect/instance-state.ts)**: The primary mechanism for sandboxing state. It manages the `ScopedCache` that ensures execution contexts are isolated per workspace directory.
