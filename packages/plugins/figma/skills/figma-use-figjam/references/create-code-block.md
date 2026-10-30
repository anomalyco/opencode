# Create Code Blocks

> Part of the [figma-use-figjam skill](../SKILL.md). Creating and configuring FigJam code block nodes.

**Scope:** Code blocks are FigJam-specific nodes created with `figma.createCodeBlock()`. They render code content with syntax highlighting and a monospace font. `CODE_BLOCK` is a first-class node type — not a shape or text node.

## Creating a Code Block

```javascript
// Snapshot existing children before creating the node — createCodeBlock() auto-appends to the page
const existingNodes = figma.currentPage.children.slice()

const cb = figma.createCodeBlock()
cb.code = 'const greeting = "Hello, FigJam!"'
cb.codeLanguage = 'JAVASCRIPT'

// Position away from (0,0) — find clear space to the right of existing content
const rightEdge = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.x + n.width)) : 0
cb.x = rightEdge + 100
cb.y = 100

return { id: cb.id, x: cb.x, y: cb.y }
```

## Supported Languages (`codeLanguage`)

Pass one of these exact uppercase string values. Omitting `codeLanguage` defaults to `PLAINTEXT`.

| Value | Language |
|---|---|
| `TYPESCRIPT` | TypeScript |
| `JAVASCRIPT` | JavaScript |
| `PYTHON` | Python |
| `GO` | Go |
| `RUST` | Rust |
| `RUBY` | Ruby |
| `CSS` | CSS |
| `HTML` | HTML |
| `JSON` | JSON |
| `GRAPHQL` | GraphQL |
| `SQL` | SQL |
| `SWIFT` | Swift |
| `KOTLIN` | Kotlin |
| `CPP` | C++ |
| `BASH` | Bash / Shell |
| `PLAINTEXT` | Plain text (no highlighting) |

If the user specifies a language not in this list, use `PLAINTEXT`.

## Setting Code Content

The `code` property maps to the node's text sublayer — set it after creating the node:

```javascript
const cb = figma.createCodeBlock()
cb.code = `function add(a, b) {
  return a + b
}`
cb.codeLanguage = 'TYPESCRIPT'
return { id: cb.id }
```

## Positioning Within a Section

To place a code block inside a FigJam section, append it to the section instead of the page:

```javascript
// Use the type-indexed criteria for the type filter, then narrow by name.
const section = figma.currentPage
  .findAllWithCriteria({ types: ['SECTION'] })
  .find((n) => n.name === 'My Section')
if (!section) throw new Error('Section not found')

const cb = figma.createCodeBlock()
cb.code = 'SELECT * FROM users WHERE active = true'
cb.codeLanguage = 'SQL'

section.appendChild(cb)

// Position relative to section origin
cb.x = 40
cb.y = 40

return { id: cb.id }
```

## Important Notes

- `CODE_BLOCK` is **FigJam-only** — this will throw in Figma design files.
- There is no theme/color API for code blocks; FigJam handles the visual styling automatically.
- Always `return` the created node's `id` for reference in follow-up calls (see figma-use rule #15).
- No font loading is required — code blocks handle their own monospace rendering.
