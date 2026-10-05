# Chrome Web Store listing

Copy these into the developer dashboard. Upload `release/opencode-browser-<version>.zip` from `bun run package`.

## Store listing

**Name:** OpenCode Browser

**Summary (132 chars max):**
OpenCode in your browser: chat in the side panel, let agents use your tabs, and change sites with scripts.

**Category:** Developer Tools

**Description:**
OpenCode Browser connects the browser to OpenCode, the open source AI coding agent running on your computer.

- Chat with OpenCode in the side panel, next to any page, and include the page you're on.
- Let agents open and use tabs to test your app, fill forms, or check a flow. Agents only use tabs they open or tabs you share.
- Hand off when it's your turn: logins, 2FA, passkeys, and payments stay with you, then the agent continues.
- Site scripts: ask the agent to change how a site looks or works, approve the script, and turn it on or off anytime.
- Works with Browser Control, so OpenCode's Browser Control MCP and CLI drive your tabs through the same extension.

Requires OpenCode on your computer. Run `npx opencode-browser-cli install` once to connect it.

Everything stays between your browser and your own OpenCode. The extension has no server of its own.

## Privacy

**Single purpose:**
Use OpenCode, an AI agent running on the user's computer, from the browser side panel, and let it work in the user's tabs at their request.

**Permission justifications:**
- `sidePanel`: The product is a side panel chat with OpenCode.
- `debugger`: Lets the user's OpenCode agent drive tabs it opened or the user shared (click, type, navigate, screenshot, read the page), the same as browser automation tools. The user sees which tabs are in use.
- `tabs`, `tabGroups`: List and open tabs for the agent, show which page the user is on, and group the agent's tabs so the user can see them.
- `webNavigation`: Know when an agent's tab finished loading before it acts.
- `storage`: Save settings, site scripts, and per-conversation permissions locally.
- `nativeMessaging`: Find the user's local OpenCode service through a helper installed by `npx opencode-browser-cli install`.
- `alarms`: Keep the connection to the local OpenCode service and Browser Control relay alive and reconnect.
- `userScripts`: Run site scripts the user approved on the sites they chose.
- `downloads`: Save files the agent was asked to download, and report downloads to it.
- `offscreen`, `tabCapture`: Record a tab when the user asks an agent for a screen recording.
- `activeTab`: Act on the current tab when the user picks "Let Browser Control use this tab".
- `contextMenus`: Adds that action to the toolbar icon's menu.
- Host permission `<all_urls>`: Agents work on whatever site the user asks for, and site scripts run on the sites the user picks.
- Optional `history`, `bookmarks`, `topSites`, `sessions`: Requested only when the user clicks Allow for an agent's request to search their history, bookmarks, top sites, or recently closed tabs.

**Remote code:** No. All extension code ships in the package. Site scripts are user-approved scripts run with the `userScripts` API.

**Data usage:** Check "Website content", "Web history" (only with the optional permission), and "User activity" (agents interact with pages). Certify: not sold, not used for unrelated purposes, not used for credit decisions. Data goes only to the user's own OpenCode on their computer.

**Privacy policy URL:** host `privacy-policy.md` (for example at opencode.ai/browser/privacy).
