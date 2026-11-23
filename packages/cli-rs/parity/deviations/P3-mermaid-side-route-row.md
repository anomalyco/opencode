# P.3: a state transition routed beside the diagram on one row

**TypeScript.** A transition that runs down a rail beside the states draws the rail from the row it leaves to the
row it arrives on, one row at a time until it reaches the arrival row. When the two rows are the same, as for a
transition from a top-level state to one nested two composites deep that sits on its row, it never reaches it, and
the renderer never returns.

**Rust.** The rail draws no rows between, and the diagram draws.

**Reason.** A fence must not hang the UI thread.
