import { searchSignature } from "./packages/codemode/src"
import { CodeModeCatalog } from "./packages/core/src/codemode/catalog"

const prompt = (catalog: CodeModeCatalog.Summary, hasMoreTools: boolean) => {
  return `Run JavaScript to orchestrate tool calls and compose their results. Imports, filesystem access, and timers are unavailable. Do not use \`fetch\`; all API calls go through \`tools\`.

Prefer an explicit \`return\`; if omitted, the final top-level expression becomes the result. Await tool calls before returning; any calls still pending when execution ends are interrupted. Run independent calls concurrently with \`Promise.all\`.

Do not infer or normalize tool names; use only the exact signatures shown below${hasMoreTools ? " or returned by `search`" : ""}, preserving bracket notation such as \`tools.<namespace>["tool-name"](input)\`.${hasMoreTools ? `

## Search

Only some tool signatures are shown. Use \`search\` to discover exact paths and signatures for additional tools:

- ${searchSignature}` : ""}

## Available tools`
}

export function render(catalog: CodeModeCatalog.Summary) {
  const hasMoreTools = true
  const tools = catalog.namespaces.flatMap((namespace) => {
    const count = namespace.count === 1 ? "1 tool" : `${namespace.count} tools`
    const label = (() => {
      if (namespace.entries.length === namespace.count) return count
      if (namespace.entries.length === 0) return `${count}, none shown`
      return `${count}, ${namespace.entries.length} shown`
    })()
    return [`- ${namespace.name} (${label})`, ...namespace.entries.map((entry) => entry.line)]
  })

  return `${prompt(catalog, hasMoreTools)}

${tools.join("\n")}`
}
