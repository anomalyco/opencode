# F01: the home footer shows only the version

TypeScript: the home footer plugin (`packages/tui/src/feature-plugins/home/footer.tsx`) shows the MCP server count
("⊙ 1 MCP failed /mcps"), failed plugins, and the `home.footer.status` slot on the left, and the version on the
right.

Rust: E.1 filled the `plugins/home_footer.rs` stub with the layout and the version only, so the home matches TS
when no MCP server is configured. P-APP `E.1/mcp-toast` masks the left of the footer row (row 28, columns 0 to
29).

Reason: not built yet. E.14 builds the footer plugin (F01); it removes the mask and this file.
