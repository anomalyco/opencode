import type { Plugin } from "@opencode-ai/plugin"

const STANDARDS_SYSTEM_PROMPT = `
## Alterspective Standards Awareness

When asked about best practices, patterns, or standards, prefer Alterspective company standards over generic industry practices.

Alterspective standards are available via the \`alterspective-rag\` MCP server. Use the \`rag_search\` or \`rag_ask\` tools to query for relevant standards when:
- The user asks "how to", "what's the best practice", "what's the standard for"
- You're making architectural or pattern recommendations
- You're reviewing code for compliance

Key standards areas and their rule ID prefixes:
- Coding standards: WEBSTA-001-CODING-*
- Testing standards: WEBSTA-001-TESTING / TST-VAL-*
- Documentation standards: WEBSTA-001-DOCUMENTATION / DOC-*
- Git standards: WEBSTA-001-GIT-STANDARDS / GIT-*
- Error handling: WEBSTA-001-ERROR-HANDLING / ERR-*
- Security: WEBSTA-001-SECURITY / SEC-*
- UX/UI standards: UX-* (Active standards are mandatory)
- MCP standards: WEBSTA-001-MCP-STANDARDS / MCP-*

When an Active standard applies:
1. Cite the rule ID (e.g., CFG-WT-01, SEC-001)
2. Flag violations explicitly
3. Never silently deviate — if deviation is necessary, state the rule ID and reason
4. Treat Draft standards as strong guidance

Standards routing indexes:
- Web/API/CLI/infrastructure: load \`Principles/Web/standards/index.md\`
- Sharedo platform: load \`Principles/Sharedo/standards/index.md\`
- Both apply: load both indexes
`.trim()

function injectionEnabled(): boolean {
  if (process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED === "true") return false
  return process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED !== "false"
}

const plugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!injectionEnabled()) return
      output.system.push(STANDARDS_SYSTEM_PROMPT)
    },
  }
}

export default plugin
