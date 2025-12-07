## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`

## Code Formatting

- After changing TypeScript code, run `bun run ./script/format.ts` to format the code
- This ensures consistent formatting across the codebase

## Type Safety

- NEVER use `as any` or type casts to work around type errors caused by outdated SDK types
- If adding new schemas/types to `message-v2.ts` or other core files causes SDK type mismatches, regenerate the SDK first
- Run `cd packages/sdk/js && bun ./script/build.ts` to regenerate SDK types after schema changes
- Type errors are signals that something needs to be fixed properly, not suppressed

### Type Predicates for Discriminated Unions

- NEVER use `as` type assertions when filtering discriminated unions (e.g., `find()`, `filter()`)
- ALWAYS use type predicate functions instead:

```typescript
// ❌ BAD: Using 'as' cast
const subtask = parts.find((x) => x.type === "subtask") as SubtaskPart | undefined

// ✅ GOOD: Using type predicate
const isSubtaskPart = (part: Part): part is SubtaskPart => part.type === "subtask"
const subtask = parts.find(isSubtaskPart)
```

**Why**: TypeScript's discriminated union narrowing doesn't work with array methods like `find()` or `filter()` because the predicate function doesn't act as a type guard. The return type is still the full union type, not the narrowed type. Type predicates (`part is Type`) explicitly tell TypeScript that the returned value matches a specific variant of the union.

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
