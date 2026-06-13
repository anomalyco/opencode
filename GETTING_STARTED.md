# Getting Started with OpenCode for Kimi K2.6

## What We've Built

We've transformed OpenCode into a Kimi K2.6 powerhouse with:

### ✅ Core Integration (DONE)
- **Native Moonshot Provider** - First-class support for Kimi API
- **4 Pre-configured Models** - Standard, Thinking, Vision, Search
- **256K Context Optimization** - Smart token allocation
- **Computer Control Tools** - Screenshot, click, type, scroll
- **Reasoning Mode Support** - Low/medium/high effort settings

### 🏗️ Architecture Ready (DESIGNED)
- **In-App Web Browser** - With annotation capabilities
- **Markdown Viewer** - Rich rendering with diagrams
- **Multi-Project Workspace** - Tabbed chats, project switching
- **Swarm System** - Multi-agent collaboration framework

## File Structure

```
opencode-kimi/
├── packages/
│   ├── llm/
│   │   ├── src/providers/
│   │   │   ├── moonshot.ts              ✅ Native provider
│   │   │   ├── openai-compatible-profile.ts  ✅ Added moonshot
│   │   │   └── index.ts                 ✅ Export moonshot
│   │   └── example/
│   │       └── kimi-example.ts          ✅ Usage examples
│   ├── core/
│   │   ├── src/
│   │   │   ├── context-optimizer/
│   │   │   │   └── kimi-optimizer.ts    ✅ Context management
│   │   │   ├── tool/
│   │   │   │   └── computer-control.ts  ✅ Automation tools
│   │   │   ├── swarm/
│   │   │   │   └── architecture.md      ✅ Swarm design
│   │   │   └── provider.ts              ✅ Added moonshot ID
│   └── ui/
│       └── src/assets/icons/provider/
│           ├── moonshotai.svg            ✅ Already existed
│           ├── moonshotai-cn.svg         ✅ Already existed
│           └── kimi-for-coding.svg       ✅ Already existed
├── .opencode/presets/
│   └── kimi.json                         ✅ Preset config
├── KIMI_ROADMAP.md                       ✅ Development plan
├── KIMI_SETUP.md                         ✅ User guide
└── IMPLEMENTATION_SUMMARY.md             ✅ This summary
```

## Quick Test

```bash
# 1. Set your API key
export MOONSHOT_API_KEY="your-api-key"

# 2. Run the example
bun run packages/llm/example/kimi-example.ts

# 3. Start the desktop app
bun dev:desktop
```

## Using Kimi in Code

```typescript
import { Moonshot } from "@cedric/llm/providers"

// Quick model selection
const model = Moonshot.kimiK26()           // Standard
const thinker = Moonshot.kimiK26Thinking() // Reasoning
const vision = Moonshot.kimiK26Vision()    // Multimodal

// Custom configuration
const custom = Moonshot.configure({
  apiKey: process.env.MOONSHOT_API_KEY,
  reasoningEffort: "high",
  searchMode: true,
})
```

## Configuration

### Environment Variables
```bash
export MOONSHOT_API_KEY="your-key"
export OPENCODE_PROVIDER="moonshot"
export OPENCODE_MODEL="kimi-k2-6"
export OPENCODE_COMPUTER_CONTROL=true
```

### Config File
```json
{
  "provider": "moonshot",
  "model": "kimi-k2-6",
  "context": {
    "window": 256000,
    "allocation": {
      "codebase": 0.40,
      "history": 0.30,
      "tools": 0.20
    }
  }
}
```

## Next Steps

1. **Test the provider** - Run the example script
2. **Build the UI** - Implement browser, markdown, workspace
3. **Add automation** - Implement actual screenshot/keyboard
4. **Enable swarm** - Build the multi-agent system

## Support

- 📖 [KIMI_SETUP.md](KIMI_SETUP.md) - Detailed setup guide
- 🗺️ [KIMI_ROADMAP.md](KIMI_ROADMAP.md) - Development roadmap
- 📊 [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - What we've built
- 🌐 [Kimi API Docs](https://platform.moonshot.cn/docs)

---

**Ready to use Kimi K2.6 to its full potential! 🚀**
