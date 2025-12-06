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
