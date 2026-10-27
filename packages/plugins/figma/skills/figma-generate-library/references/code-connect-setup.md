> Part of the [figma-generate-library skill](../SKILL.md).

# Code Connect Setup Reference

This reference covers all Code Connect tooling available to the figma-generate-library agent: the `add_code_connect_map` tool, `get_code_connect_map` for verification, `send_code_connect_mappings` for bulk application, variable code syntax, framework labels, and the decision of when to map per-component vs. in a final pass.

---

## 1. What Code Connect Does

Code Connect links a Figma component node to its code implementation so that:

- **Dev Mode** shows a real code snippet (from your codebase) instead of an auto-generated approximation when a developer inspects a component.
- **MCP `get_design_context`** returns `componentName`, `source`, and a rendered snippet alongside design tokens, enabling accurate AI-assisted code generation.
- **`search_design_system`** can return code references alongside Figma component metadata.

---

## 2. The Three MCP Tools

### 2a. add_code_connect_map — single mapping

Maps one Figma node to one code component.

**Parameters:**

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `nodeId` | string | Yes (remote) / Optional (desktop) | Format `123:456`. Must be a published component or component set. |
| `fileKey` | string | Yes (remote) | The Figma file key. |
| `source` | string | Yes | Path in the codebase (e.g. `src/components/Button.tsx`) or a URL. |
| `componentName` | string | Yes | The code component name (e.g. `Button`). |
| `label` | enum | Yes | Framework label — see Section 4 for valid values. |
| `template` | string | Optional | Executable JS template code. Providing this creates a **template** mapping instead of a simple **component-path** mapping. Gated behind a server-side feature flag — falls back to a simple mapping when disabled. |
| `templateDataJson` | string | Optional | JSON string with optional fields: `isParserless`, `imports`, `nestable`, `props`. |

**Two mapping tiers:**

1. **Simple mapping (component-path):** Only `source`, `componentName`, and `label` provided. Associates the Figma component with a code path + name. Dev Mode generates a basic JSX snippet from Figma prop names. This is the default — use it first.

2. **Template mapping:** `template` is also provided. The template is executed in a sandboxed QuickJS environment and dynamically renders the snippet based on the actual instance's property values. Use this when precise prop-level Code Connect is required by the user.

**Common error codes:**

| Error | Meaning | Fix |
|-------|---------|-----|
| `CODE_CONNECT_MAPPING_ALREADY_EXISTS` | Component is already mapped | Disconnect existing mapping in Figma UI first |
| `CODE_CONNECT_ASSET_NOT_FOUND` | Published component not found | Ensure the component is published to the library |
| `CODE_CONNECT_INSUFFICIENT_PERMISSIONS` | No edit access | Request edit permission on the file |
| `CODE_CONNECT_NO_LIBRARY_FOUND` | File is not published as a library | Publish the file as a Figma library first |

**Usage example:**

```
Tool: add_code_connect_map
Args: {
  nodeId: "123:456",
  fileKey: "abc123",
  source: "src/components/Button.tsx",
  componentName: "Button",
  label: "React"
}
```

---

### 2b. get_code_connect_map — verification

Retrieves the current Code Connect mapping for a node. Use this immediately after `add_code_connect_map` to confirm the mapping was saved, and before `send_code_connect_mappings` to audit existing state.

**Parameters:**

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `nodeId` | string | Optional | The node to check. Omit to get all mappings in the file. |
| `fileKey` | string | Yes (remote) | The Figma file key. |
| `codeConnectLabel` | string | Optional | Filter results to a specific framework label. |

**Returns:** A map of `nodeId -> { componentName, source, label, snippet, snippetImports }`.

**How to verify:**

```
1. Call add_code_connect_map with the node.
2. Immediately call get_code_connect_map(nodeId, fileKey).
3. Confirm the returned object has the expected componentName and source.
4. If the mapping is missing, check for error codes from step 1.
```

---

### 2c. send_code_connect_mappings — bulk application

Applies multiple Code Connect mappings in one call. Use after `get_code_connect_suggestions` returns a batch of unmapped components, or when doing a final-pass bulk mapping at the end of Phase 4.

**Parameters:**

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| `nodeId` | string | Optional | Context node for design fallback if mappings array is empty. |
| `fileKey` | string | Yes (remote) | The Figma file key. |
| `mappings` | array | Yes | Array of mapping objects. |

**Each mapping object:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `nodeId` | string | Yes | The Figma node identifier. |
| `componentName` | string | Yes | Code component name. |
| `source` | string | Yes | Path in the codebase. |
| `label` | enum | Yes | Framework label. |
| `template` | string | Optional | JS template code for template mapping. |
| `templateDataJson` | string | Optional | JSON template metadata. |

**Behavior:**

- All mappings are processed in parallel via POSTs to the backend.
- If any mapping fails, errors are reported per mapping — the rest succeed.
- On full success, `get_design_context` is called for the nodes and fresh design context is returned.

**Bulk workflow:**

```
1. Collect all {nodeId, componentName, source, label} pairs.
2. Call send_code_connect_mappings({ fileKey, mappings: [...all pairs...] }).
3. Review reported errors and call add_code_connect_map individually for any failures.
4. Call get_code_connect_map on a sample of nodes to spot-check.
```

---

## 3. Variable Code Syntax (Token Round-Tripping)

Setting code syntax on variables creates the bidirectional link between Figma tokens and the codebase token system. This is what enables Dev Mode to show `var(--color-bg-primary)` next to a design value instead of a raw hex.

**The three platforms:**

```javascript
// In use_figma:
variable.setVariableCodeSyntax('WEB', 'var(--color-bg-primary)');
variable.setVariableCodeSyntax('ANDROID', 'Theme.colorBgPrimary');
variable.setVariableCodeSyntax('iOS', 'Color.bgPrimary');
```

- `WEB` — used for CSS custom properties, design token JSON, and any web framework.
- `ANDROID` — used for Jetpack Compose theme references and Android resource names.
- `iOS` — used for SwiftUI Color extensions and UIKit color methods.

**Derivation rules (in priority order):**

1. **Best:** Use the exact token name from the codebase. Search the codebase for CSS custom properties (`--`), Swift color extensions, or Kotlin theme references and use those exact strings.
2. **Good:** Derive from the Figma variable name with a consistent transformation: replace `/` and spaces with `-`, prefix with `var(--` and suffix with `)`.
   - Example: `color/bg/primary` → `var(--color-bg-primary)`
3. **Avoid:** Guessing or inventing names that don't exist in the codebase.

**Consistency rule:** The transformation must be uniform. If you use `var(--color-bg-primary)` for one variable, use the same `var(--{path-with-hyphens})` pattern for all variables in that collection.

**WEB syntax bulk example:**

```javascript
// In use_figma — set WEB code syntax on every variable in matching collections.
// flatMap all variable IDs across matching collections into a single
// Promise.all so the lookups run in parallel across collections too — same
// pattern as `listVariableCollectionsAndVariables` in variable-patterns.md.
// setVariableCodeSyntax is sync, so the writes don't need to be batched.
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const ids = collections
  .filter(c => c.name === 'Color')
  .flatMap(c => c.variableIds);
const vars = await Promise.all(
  ids.map(id => figma.variables.getVariableByIdAsync(id))
);
for (const v of vars) {
  if (!v) continue;
  // Derive: "color/bg/primary" → "var(--color-bg-primary)"
  const cssName = 'var(--' + v.name.toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-') + ')';
  v.setVariableCodeSyntax('WEB', cssName);
}
```

---

## 4. Framework Labels

The following labels are valid for all Code Connect MCP operations. Use the label that matches your codebase framework.

| Label | Use for |
|-------|---------|
| `React` | React / JSX / TSX components |
| `Web Components` | Native Web Components, Lit, FAST |
| `Vue` | Vue 2 and Vue 3 SFCs |
| `Svelte` | Svelte components |
| `Storybook` | Storybook stories with Code Connect integration |
| `Javascript` | Plain JavaScript, framework-agnostic |
| `Swift` | Swift / UIKit |
| `Swift UIKit` | UIKit specifically |
| `Objective-C UIKit` | Objective-C with UIKit |
| `SwiftUI` | SwiftUI view components |
| `Compose` | Jetpack Compose (Android) |
| `Java` | Java Android components |
| `Kotlin` | Kotlin Android (non-Compose) |
| `Android XML Layout` | Android XML layout files |
| `Flutter` | Flutter / Dart widgets |
| `Markdown` | Documentation or MDX components |

**HTML note:** The label `HTML` is used by the Code Connect CLI's HTML parser (for Angular, Vue, and Web Components without a framework-specific parser), but the MCP tools use `Web Components` or `Vue` directly. Check the codebase framework before selecting.

---

## 5. Per-Component vs. Final-Pass Strategy

### Per-component (preferred for new builds)

Map Code Connect immediately after creating a component, while the context is fresh (Phase 3, step 3h in the SKILL.md workflow):

**Advantages:**
- The node ID is already in hand from the creation script.
- You know exactly which code component this Figma component corresponds to (you just designed it to match).
- Errors surface early, before building dependent components.

**When to use:** Any time you create a Figma component that has a clear 1:1 match with an existing code component.

### Final pass (for bulk mapping at Phase 4)

Collect all unmapped components and map them in one `send_code_connect_mappings` call:

**Advantages:**
- One bulk call instead of N individual calls.
- Can use `get_code_connect_suggestions` to discover unmapped components automatically.
- Better for importing existing Figma files where you didn't control creation.

**When to use:** Retrofitting Code Connect onto an existing file, or when the codebase mapping requires research that is better done after all components are created.

### Hybrid (recommended for large systems)

- Map atoms (Button, Input, Badge, Avatar) **per-component** during Phase 3.
- Map molecules and organisms in a **final pass** during Phase 4 after all atoms are mapped, since molecule snippets reference atom Code Connect IDs.

---

## 6. Verification in Dev Mode

After mapping:

1. Open the Figma file in the browser or desktop app.
2. Switch to Dev Mode (the `</>` icon in the toolbar).
3. Select a component instance (not the main component — an instance placed on a page).
4. In the Inspect panel, the code snippet should show the Code Connect output instead of auto-generated code.
5. If the snippet is missing or shows `[auto-generated]`, run `get_code_connect_map` via MCP to confirm the mapping exists, then check that the component is published.

**Via MCP (faster during agent workflows):**

```
get_code_connect_map(nodeId: "<the component set node ID>", fileKey: "<file key>")
```

The response should include `componentName`, `source`, `label`, and a non-empty `snippet`.

---

## 7. Important Constraints

- **Published components only:** `add_code_connect_map` requires the component to be published to a library. If the file is not yet published, the mapping will fail with `CODE_CONNECT_NO_LIBRARY_FOUND`.
- **One mapping per label per node:** A node can have multiple mappings (one per framework label), but only one per label. Attempting to add a second React mapping to the same node returns `CODE_CONNECT_MAPPING_ALREADY_EXISTS`.
- **Template mappings are gated:** The `template` parameter is gated behind a server-side feature flag and may not be available in every environment. Use simple mappings unless the user explicitly requests template-level Code Connect.
- **Start simple, escalate:** Always begin with simple mappings (`source` + `componentName` + `label`). Add `template` only if the user needs precise prop-level snippet rendering.
