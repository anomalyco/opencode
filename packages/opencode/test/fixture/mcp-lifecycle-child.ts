// Stands in for the real MCP server that a launcher like `npx -y <server>` execs
// as a child of the process the stdio transport spawns. It stays alive until it
// is signalled, so a test can assert it does not outlive its launcher.
setInterval(() => {}, 1_000)
