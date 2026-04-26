# Tooling & Capabilities (Equipping the Agent)

## 1. Tool Resolution & Pre-Flight Filtering

Prior to every LLM turn, Opencode dynamically evaluates and structures the available tools through the `resolveTools` engine.

### Pre-Flight Filtering via `ToolRegistry`

Before the LLM is given a tool in its prompt payload, the `ToolRegistry` evaluates permissions. It calculates the strict intersection of **Session Permissions** and **Agent Permissions**.
If a specialized agent (e.g., `@explore`) lacks write privileges, modifying tools (e.g., `bash`, `edit`, `write`) are pruned from the Vercel AI payload entirely. This makes it physically impossible for read-only agents to hallucinate destructive actions, acting as a fundamental safety limit.

### Context Topologies & Isolation

When providing capabilities, Opencode avoids the pitfalls of standard Retrieval-Augmented Generation (RAG) applications by utilizing explicit, deterministic tooling (e.g., `grep`, `glob`, `read`) rather than passive semantic search.

Furthermore, instead of dumping massive read files into the primary thread, Opencode utilizes **Context Isolation via Sub-Agents**. The `Task` tool spawns specialized sub-agents (like `@explore`) in entirely fresh, isolated context windows. The sub-agent does the heavy reading and returns _only the synthesized answer_ to the main agent, keeping the primary agent's context window incredibly lean.

---

## 2. Synthetic & Internal Tools

Beyond standard filesystem access, Opencode injects structural and synthetic tools seamlessly.

- **`StructuredOutputTool`**: Injected dynamically when JSON schema compliance is requested, coupled with `toolChoice: "required"`.
- **Background Tooling**: The harness transparently executes internal tasks using the same tool architecture. For example, the `task` tool is utilized heavily to route requests under the hood to system subagents.

---

## 3. Dynamic Skill Loading

Rather than registering every specialized workflow as a massive set of independent LLM tools—which would quickly overwhelm the provider's tool schema limits and context window—Opencode utilizes a single, dynamic tool capability called `skill` ([`src/tool/skill.ts`](../../packages/opencode/src/tool/skill.ts)).

The `skill` tool acts as an on-demand capability injector. When an agent recognizes that a user request matches a known skill (derived from a lightweight registry prompt), it invokes the tool (e.g., `call:skill{name: "deploy-staging"}`).

The tool intercepts this call, locates the corresponding `SKILL.md` instruction file on the local filesystem, and returns it to the LLM wrapped in a `<skill_content>` block. Furthermore, the tool automatically performs a fast `ripgrep` scan of the directory where the skill is located, generating a file tree of surrounding scripts, templates, and reference files (returned in a `<skill_files>` block). This provides the LLM with deep, domain-specific awareness of the available reference files, allowing the agent to explicitly use the `read` tool to fetch those templates exactly when needed.

### Skill Creation & Resolution Paths

Skills in Opencode are fundamentally just standard directories containing a `SKILL.md` file. As implemented in [`src/skill/index.ts`](../../packages/opencode/src/skill/index.ts), the system automatically discovers skills via a multi-tiered glob scan across:

1. **Project Scope:** Local directories like `.opencode/skills/**/SKILL.md`.
2. **Global OS Scope:** User-level directories like `~/.agents/**/SKILL.md`, `~/.claude/**/SKILL.md`, and `~/.opencode/skills/**/SKILL.md`.
3. **Remote Scope:** Remote URLs defined in the user's config, which are fetched and unpacked into a local cache directory.

**Autonomous Creation:** Because skills are simply files on disk, users do not need to create them manually. A user can simply prompt the primary `build` agent: _"Create a skill called 'deploy-staging' that includes a bash script to push this repo to our server."_ The agent will utilize its standard `write` tools to create the directory, write the bash script, and construct the `SKILL.md` file. On the very next execution turn, the Opencode Glob scanner will detect the new directory, parse the frontmatter, and instantly make the skill available in the agent's tool registry.

---

## 4. Source Code Reference

The mechanics discussed in this document are primarily implemented in the following files:

- **[`src/tool/registry.ts`](../../packages/opencode/src/tool/registry.ts)**: The core `ToolRegistry` service responsible for pre-flight filtering and aggregating available capabilities before passing them to the Vercel AI SDK.
- **[`src/tool/skill.ts`](../../packages/opencode/src/tool/skill.ts)**: The tool implementation that intercepts `call:skill` requests, parses the frontmatter, and injects the raw `SKILL.md` content into the conversational context.
- **[`src/tool/task.ts`](../../packages/opencode/src/tool/task.ts)**: The sub-agent delegation tool used to spin up completely fresh, isolated context windows (like `@explore`), returning only synthesized answers to the primary thread.
