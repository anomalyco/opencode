- To test opencode in the `packages/opencode` directory you can run `bun dev`
- To regenerate the javascript SDK, run ./packages/sdk/js/script/build.ts
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- the default branch in this repo is `dev`

## Desktop App Verification (MCP)

When editing the desktop app (`packages/desktop`), you MUST verify your changes visually using the tauri-plugin-mcp:

1. **Start the desktop app in dev mode:**
   ```bash
   cd packages/desktop && bun run tauri dev
   ```

2. **Wait for the MCP socket** to be created at `/tmp/tauri-mcp.sock`

3. **Capture a screenshot** to verify your changes:
   ```javascript
   // Save this as a temp script and run with node
   const net = require('net');
   const fs = require('fs');

   const client = net.createConnection({ path: '/private/tmp/tauri-mcp.sock' }, () => {
     const request = JSON.stringify({
       command: 'take_screenshot',
       payload: { window_label: 'main', quality: 80 }
     }) + '\n';
     client.write(request);
   });

   let buffer = '';
   client.on('data', (data) => {
     buffer += data.toString();
     const newlineIndex = buffer.indexOf('\n');
     if (newlineIndex !== -1) {
       const response = JSON.parse(buffer.substring(0, newlineIndex));
       if (response.success && response.data?.data) {
         const base64Data = response.data.data.replace(/^data:image\/\w+;base64,/, '');
         fs.writeFileSync('/tmp/tauri_screenshot.jpg', Buffer.from(base64Data, 'base64'));
         console.log('Screenshot saved to /tmp/tauri_screenshot.jpg');
       }
       client.end();
     }
   });
   ```

4. **Read the screenshot** using the Read tool to visually verify the UI changes.

The MCP plugin is only active in debug builds and provides:
- Screenshot capture
- DOM access
- Mouse/keyboard input simulation
- localStorage management
- JavaScript execution in app context
