# T04: the T.1 status row

TypeScript: there is no status row. The connection state shows only as the reconnecting overlay (T04), and the
directory shows in the prompt footer.

Rust: T.1 adds a last row with the directory and the connection state ("● connected"), until E.1 builds the
overlay. Every P-APP checkpoint of `H.2/home-sessions` and `H.2/session-open` differs in that row.

Reason: not built yet. E.1 replaces the row with the overlay, then removes this file and the `deviation`
entries that name it.
