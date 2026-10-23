# Chrome Web Store listing

Copy these into the developer dashboard. Upload `release/opencode-browser-<version>.zip` from `bun run package`.

## Store listing

**Name:** OpenCode Browser

**Summary (132 chars max):**
Let your OpenCode agents use your browser: open and drive tabs, take screenshots, and hand logins back to you.

**Category:** Developer Tools

**Description:**
OpenCode Browser lets OpenCode, the open source AI coding agent running on your computer, use your real browser through its browse tools.

- Agents open their own tabs to test your app, fill forms, or check a flow, grouped so you can see them. Idle agent tabs close by themselves.
- Want an agent to use a tab you have open? Click the toolbar button on it. Click again to take it back.
- Hand off when it's your turn: logins, 2FA, passkeys, and payments stay with you, then the agent continues.
- Agents use Playwright, take screenshots, capture network traffic, and record the tab when you ask.

Requires OpenCode on your computer. Run `npx opencode-browser-cli install` once to add the browse tools.

Everything stays between your browser and the OpenCode tools on your computer. The extension has no server of its own.

## Privacy

**Single purpose:**
Let OpenCode, an AI agent running on the user's computer, use the user's browser tabs at their request.

**Permission justifications:**
- `debugger`: Lets the user's OpenCode agent drive tabs it opened or the user shared (click, type, navigate, screenshot, read the page), the same as browser automation tools. The toolbar badge shows which tabs are in use.
- `tabs`, `tabGroups`: Open and list tabs for the agent, and group the agent's tabs so the user can see them.
- `storage`: Remember which tabs agents opened and the agent tab groups across extension restarts.
- `alarms`: Keep the connection to the local OpenCode relay alive, reconnect, and close agent tabs left idle.
- `offscreen`, `tabCapture`: Record a tab when the user asks an agent for a screen recording.
- Host permission `<all_urls>`: Agents work on whatever site the user asks for, and the page shows a banner while an agent works there or waits for the user.

**Remote code:** No. All extension code ships in the package.

**Data usage:** Check "Website content" and "User activity" (agents read and interact with pages). Certify: not sold, not used for unrelated purposes, not used for credit decisions. Data goes only to the OpenCode tools on the user's computer.

**Privacy policy URL:** host `privacy-policy.md` (for example at opencode.ai/browser/privacy).
