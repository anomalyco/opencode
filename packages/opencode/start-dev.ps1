# PowerShell script to start opencode with local frontend
$env:LOCAL_FRONTEND="1"
bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999
