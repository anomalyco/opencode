Write a CodeMode program to answer the request. Return code only.
Execute JavaScript in a confined runtime. Inside this program, `tools` contains only the host-provided tools listed or searchable below; surrounding agent tools are not available unless listed here.
Do not infer or normalize tool names; use only exact signatures shown below or returned by search.

## Workflow

1. If the exact signature is not listed below, first search: `const { items } = await tools.$codemode.search({ query: "<intent + key nouns>" })`.
2. Read the matches: each item is `{ path, description, signature }` - read the description before using an unfamiliar tool.
3. Call the result's `path` as-is; bracket notation and quotes are part of the path.
4. Parse text results: `const data = typeof res === "string" ? JSON.parse(res) : res` - most tools return JSON as a string.
5. Return only the fields you need: `return { <field>: data.<field> }` - raw payloads get truncated and waste context.

## Rules

- Only tools listed here or returned by `tools.$codemode.search` are available inside `tools`; tools from the surrounding agent/runtime are not implicitly exposed.
- Filter, aggregate, and transform collections in code - never return them raw or call a tool per item across messages.
- A result typed `Promise<unknown>` has no guaranteed shape - verify what actually came back before relying on its fields.
- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))`, or use `tools.<namespace>["tool-name"](item)` when the listed signature uses bracket notation.
- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.
- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.
- Search results are paginated from zero-based offset 0. When `page.next` is not null, continue with `await tools.$codemode.search({ ...request, ...page.next })`.

## Syntax

Standard modern JavaScript works: functions/closures, destructuring, template literals, loops, try/catch, spread, optional chaining, the usual Array/String/Object/Math/JSON methods, plus Date, RegExp, Map, Set, and Promise.all/allSettled/race/resolve/reject.
TypeScript type annotations are allowed and stripped before execution (decorators are not supported).
Not supported (each fails with a message naming the alternative): classes, generators, for await...of, .then/.catch/.finally (use await with try/catch).
Dates serialize to ISO strings at data boundaries; Map/Set/RegExp serialize to `{}`.

## Available tools (PARTIAL - 3 of 8 shown; find the rest with tools.$codemode.search)

- context7 (1 tool)
  - tools.context7["resolve-library-id"](input: {
  /** Library name or product to resolve */
  libraryName: string,
}): Promise<{
  id: string,
  title: string,
}> // Resolve a package name to its Context7 library ID
- github (4 tools, 1 shown)
  - tools.github.list_issues(input: {
  /** Repository owner */
  owner: string,
  /** Repository name */
  repo: string,
  /** Filter by issue state */
  state?: "open" | "closed",
}): Promise<Array<{
  number: number,
  title: string,
  state: string,
}>> // List issues in a GitHub repository
- linear (3 tools, 1 shown)
  - tools.linear.search_issues(input: {
  /** Search terms */
  query: string,
  /**
   * Maximum results to return
   * @default 20
   */
  limit?: number,
}): Promise<Array<{
  id: string,
  identifier: string,
  title: string,
}>> // Search Linear issues

Search returns complete callable signatures:
- tools.$codemode.search(input: {
  query?: string,
  namespace?: string,
  limit?: number,
  offset?: number,
}): Promise<{
  items: Array<{
      path: string,
      description: string,
      signature: string,
    }>,
  remaining: number,
  next: {
      offset: number,
    } | null,
}>
