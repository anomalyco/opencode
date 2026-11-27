# P.3: a group nested in itself

**TypeScript.** Subgraphs and composite states name their parent by ID. A subgraph opened inside one of the same
ID, directly (`subgraph Outer` inside `subgraph Outer`) or by way of another (`X` inside `Y`, then `Y` inside
another `X`), and the same for `state X { … }`, make a group its own ancestor. Collecting a group's descendants then
recurses until the stack overflows, and the renderer throws a `RangeError`.

**Rust.** Opening such a group is a syntax error at its line, so the fence keeps its previous diagram of the kind
or shows its source, as for any unsupported statement.

**Reason.** In Rust the same recursion overflows the stack and aborts the process.
