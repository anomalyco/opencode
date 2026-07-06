# Tool Definition

## Name

`execute`

## Tool Description

Execute a JavaScript/TypeScript program that orchestrates the connected MCP tools inside a confined runtime.
The full usage guide and the catalog of available tools follow below.
<CODEMODE_INSTRUCTIONS_HERE>

# Parameter Definition

## `code`

Type: `string`

Required: `true`

Description:

JavaScript source to execute. Inside CodeMode, `tools` contains only the MCP/CodeMode tools listed in this execute tool's description; top-level opencode tools like bash, read, or lsp are not available unless listed there. Call available tools using the exact signatures shown in this execute tool's description, compose the results, and `return` the final value.
