# OpenCode IM Integration

Integrate instant messaging platforms (such as Telegram) with the OpenCode AI assistant, allowing you to directly control and interact with your local projects from your phone.

## Features

* **💬 Multi-project support with seamless switching**: Configure multiple local projects and quickly switch the AI workspace context using chat commands.
* **📷 Image and media support**: Send screenshots of local errors or diagrams for AI analysis (up to 20MB), with built-in storage cleanup.
* **🔐 Privacy and whitelist protection**: Configure Telegram user ID whitelists to prevent strangers or unauthorized users from accessing your local resources.
* **⚡ Session compression and long-term management**: Automatically compresses long conversations to reduce token usage and notifies users to save resources.

Currently optimized for **Telegram** 🤖, with plans to expand to Slack, WhatsApp, Discord, and more.

---

## Quick Start 🚀

### 1. Prepare your Telegram bot

#### Step 1: Get your Telegram Bot Token

1. Search for [@BotFather](https://t.me/botfather) on Telegram and start a conversation.
2. Send `/newbot` to create a new bot.
3. Follow the prompts to set the bot name. You’ll receive a token like `123456789:ABCDEF-xxxxxxxxx`. Save it securely.

#### Step 2: Get your User ID (Whitelist ID)

1. Search for [@userinfobot](https://t.me/userinfobot) or `@getmyid_bot` on Telegram.
2. Click Start or send a message. The bot will return your numeric ID, e.g., `123456789`.
3. Save this number — it will be used as your whitelist credential to access local projects.

---

### 2. Initialize the configuration file

The configuration file is usually placed in the directory where you run the program (current workspace) or your home directory, named ***`.opencode.json`*** (older versions may use `.opencode/opencode.json`).

Create and configure `.opencode.json` in your OpenCode root directory or any project directory you prefer. Below is a complete example with **multi-project support**:

```json
{
  "projects": {
    "myproject": {
      "name": "My Main Project",
      "directory": "/Users/xxx/projects/myproject"
    },
    "opencode": {
      "name": "OpenCode Itself",
      "directory": "/Users/xxx/projects/opencode"
    }
  },
  "model": "zai-coding-plan/glm-4.7",
  "im": {
    "type": "telegram",
    "token": "YOUR_TELEGRAM_BOT_TOKEN",
    "allowedUsers": [
      123456789
    ],
    "maxFileSize": 20971520,
    "cleanupDays": 15
  }
}
```

*🔔 Tip: The first project in `projects` will be used as the default startup directory. The `allowedUsers` array must contain your numeric Telegram ID. If omitted, anyone who finds your bot could control your terminal engine (highly discouraged!).*

---

### 3. Run the service

After configuration, go to the OpenCode source directory and start the core `serve` service. This launches the backend engine and establishes a bidirectional connection with Telegram.

```bash
# If running from source:
cd packages/opencode
bun install

# Start local service and IM integration
bun run src/index.ts serve
```

If successful, your terminal will show logs similar to:

```text
opencode server listening on http://127.0.0.1:52562
📱 Loading IM integration from: @opencode-ai/im-integration/manager
...
🔄 Connecting to opencode server on http://127.0.0.1:52562... (attempt 1/5)
✅ Connected to opencode server, default directory: /Users/xxx/projects/myproject
🤖 Creating Telegram bot with token...
🚀 IM integration initialized
```

---

### 4. Start exploring

Now return to Telegram, open your bot, and press Start or send `hi`. The AI will connect to your codebase.

You can also use built-in slash commands for multi-project management:

| Command                  | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `/help`                  | Show help menu                                             |
| `/list_projects`         | List all configured projects from `.opencode.json`         |
| `/switch_project <name>` | Switch the AI environment to another project               |
| `/session_info`          | Show session info including project, ID, and message stats |

> 💡 **Pro tip**: You can send a screenshot anytime. The AI will combine visual context with your local code and help debug directly within Telegram.

---

## Advanced Configuration Reference

| JSON Path         | Type       | Description               | Notes                                                                |
| ----------------- | ---------- | ------------------------- | -------------------------------------------------------------------- |
| `im.enabled`      | `boolean`  | Enable or disable the bot | Default `true` (set to `false` to temporarily disable IM)            |
| `im.type`         | `string`   | IM platform type          | Currently must be `"telegram"`                                       |
| `im.token`        | `string`   | Bot token                 | Obtained from BotFather                                              |
| `im.allowedUsers` | `[number]` | Whitelist IDs             | Only users in this list can control the bot — very important!        |
| `im.storagePath`  | `string`   | Media storage path        | Temporary storage for received files/images, auto-managed by default |
