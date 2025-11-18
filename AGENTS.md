## IMPORTANT

- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()

## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE. Here is an example illustrating how to execute 3 parallel file reads in this chat environment:

json
{
"recipient_name": "multi_tool_use.parallel",
"parameters": {
"tool_uses": [
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.tsx"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.ts"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.md"
}
}
]
}
}

## UI Debugging Process

When tracking down where a visual element is rendered, follow this process:

1. Start with visual analysis  
   - Note branding text, dynamic values (versions, names), layout (header/footer/sidebar), and any unique labels or buttons.
2. Try literal search first  
   - Grep for obvious static strings or close patterns.  
   - If they fail, assume key parts may be dynamic (e.g., version numbers, agent names).
3. Pivot to architecture when strings fail  
   - Identify the UI stack (web, TUI, desktop) and relevant package (`packages/opencode`, `packages/opentui-web`, etc.).  
   - Inspect the directory structure for root layout files (e.g., `app.tsx`, `layout.tsx`, `header.tsx`, `footer.tsx`).
4. Inspect root/layout components  
   - Open likely shell components and look for bottom bars, status bars, or global wrappers that match the screenshot’s structure.  
   - Match patterns like split logo text, version rendering (`Installation.VERSION`), current path, and key labels (`tab`, etc.).
5. Confirm with targeted search  
   - Once you suspect a file (e.g., `app.tsx`), search within it for partial patterns (e.g., just `"tab"` or `"codesurf"`).  
   - Verify by editing something harmless (spacing or a label) and re-running the correct dev command to confirm you have the right source.
