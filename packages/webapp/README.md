# OpenCode WebApp

Modern web interface for OpenCode - An AI-powered coding assistant.

## Features

- 🚀 **Real-time Communication** - WebSocket-based live updates
- 💬 **Interactive Chat** - Natural conversation with AI assistant
- 📁 **Session Management** - Create, organize, and switch between sessions
- 🎨 **Modern UI** - Clean, dark-themed interface built with SolidJS
- ⚡ **Fast & Responsive** - Optimized with Vite and SolidJS reactivity
- 🔧 **Tool Visualization** - See AI tool executions in real-time

## Tech Stack

- **Framework**: [SolidJS](https://www.solidjs.com/) - Fast, reactive UI library
- **Build Tool**: [Vite](https://vitejs.dev/) - Lightning-fast development
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS
- **Language**: TypeScript - Type-safe development
- **Communication**: WebSocket + REST API - Real-time and reliable

## Prerequisites

- Node.js 18+ or Bun 1.0+
- OpenCode server running (default: http://localhost:3000)

## Installation

```bash
# Using npm
npm install

# Using bun
bun install
```

## Development

### 1. Start OpenCode Server

First, start the OpenCode server with WebSocket support:

```bash
cd ../opencode
bun run dev serve --port 3000
```

The server should display:
```
[server] server started { port: 3000, hostname: "0.0.0.0", websocket: "enabled" }
```

### 2. Start Webapp

In a new terminal:

```bash
# Using npm
npm run dev

# Using bun
bun run dev
```

The webapp will be available at: http://localhost:5173

### 3. Open Browser

Navigate to http://localhost:5173 and you should see:
- WebSocket connection status in the header
- Session list on the left sidebar
- Chat interface in the main area

## Usage

### Creating a Session

1. Click the **"+ New"** button in the sidebar
2. A new session will be created and selected automatically

### Sending Messages

1. Select a session from the sidebar
2. Type your message in the input box at the bottom
3. Press **Enter** to send (or click the Send button)
4. Use **Shift + Enter** for new lines

### Deleting Sessions

1. Hover over a session in the sidebar
2. Click the trash icon that appears
3. Confirm deletion

### Real-time Updates

When connected via WebSocket, you'll see:
- ✅ Live message streaming
- ✅ Tool execution visualization
- ✅ Instant session updates
- ✅ Connection status indicator

## Project Structure

```
src/
├── api/
│   └── client.ts           # API client (REST + WebSocket)
├── components/
│   ├── SessionList.tsx     # Session sidebar component
│   ├── MessageView.tsx     # Message display component
│   └── ChatInput.tsx       # Message input component
├── stores/
│   └── session.ts          # Global state management
├── styles/
│   └── index.css           # Tailwind CSS styles
├── types/
│   └── index.ts            # TypeScript type definitions
├── App.tsx                 # Root component
└── main.tsx                # Application entry point
```

## Configuration

### API Endpoints

The webapp uses a proxy to forward requests to the OpenCode server:

```javascript
// vite.config.ts
proxy: {
  "/api": {
    target: "http://localhost:3000",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
  },
  "/ws": {
    target: "ws://localhost:3000",
    ws: true,
  },
}
```

### Customizing Server URL

To connect to a different server, modify `vite.config.ts`:

```javascript
proxy: {
  "/api": {
    target: "http://your-server:port",
    // ...
  },
}
```

## Building for Production

```bash
# Build the webapp
npm run build

# Preview production build
npm run preview
```

The built files will be in the `dist/` directory.

## Deployment

### Static Hosting

Since this is a SPA (Single Page Application), you can deploy it to:

- **Vercel**: `vercel deploy`
- **Netlify**: `netlify deploy --prod`
- **Cloudflare Pages**: Connect your git repository
- **AWS S3 + CloudFront**: Upload `dist/` folder

### Important Notes

1. **API Proxy**: In production, you'll need to configure the API URL differently since the Vite proxy won't be available. Options:
   - Use environment variables
   - Configure your hosting platform's proxy rules
   - Update the API client to use absolute URLs

2. **WebSocket URL**: Update the WebSocket URL in production:
   ```typescript
   const wsURL = process.env.VITE_WS_URL || 'ws://localhost:3000/ws'
   ```

## Troubleshooting

### WebSocket Won't Connect

1. **Check server is running**: `curl http://localhost:3000/session`
2. **Check WebSocket endpoint**: Open browser DevTools → Network → WS
3. **Check CORS**: Server should have CORS enabled (it does by default)
4. **Check firewall**: Ensure port 3000 is accessible

### Styles Not Loading

1. **Rebuild Tailwind**: `npm run build`
2. **Clear cache**: Delete `node_modules/.vite` and restart dev server

### Messages Not Appearing

1. **Check WebSocket connection**: Look at the connection status in the header
2. **Check browser console**: Look for errors
3. **Check network tab**: Verify API requests are succeeding

## Development Tips

### Hot Module Replacement

Vite supports HMR out of the box. Changes to components will update instantly without page reload.

### TypeScript

The project is fully typed. Run type checking with:

```bash
npm run typecheck
```

### Browser DevTools

Use React/Solid DevTools extension for debugging component state:
- [Solid DevTools](https://chrome.google.com/webstore/detail/solid-devtools/)

## API Documentation

Once the OpenCode server is running, visit:
- OpenAPI Docs: http://localhost:3000/doc
- WebSocket Guide: See `../../WEBSOCKET_GUIDE.md`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

See the main OpenCode repository for license information.

## Support

- [GitHub Issues](https://github.com/opencode/opencode/issues)
- [Documentation](https://docs.opencode.com)

---

Built with ❤️ using SolidJS and Vite
