export * as ConfigBuiltin from "./builtin.js"

// local-only: configuration compiled into the binary. It loads after every managed source, so its settings and
// policies outrank system, user, project, and OPENCODE_CONFIG_CONTENT config. Web search stays off because a search
// query can carry code from the session to an external service. To lift a lock, edit this text and rebuild.
export const text = `{
  "websearch": false,
  "policies": [
    { "action": "websearch.use", "resource": "*", "effect": "deny" }
  ]
}`

export const source = "opencode built-in configuration"
