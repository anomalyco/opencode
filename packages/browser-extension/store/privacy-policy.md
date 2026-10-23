# OpenCode Browser privacy policy

_Last updated: October 18, 2026_

OpenCode Browser is a browser extension that lets OpenCode, running on your own computer, use your browser. This policy explains what it handles and where that goes.

## What the extension handles
- **Page content, screenshots, network traffic, and actions** in tabs an agent opened, or tabs you let agents use with the toolbar button.
- **Recordings** of a tab, when you ask an agent for one.
- Which tabs agents opened, kept in your browser's extension storage so idle ones can be closed.

## Where it goes
- To **the OpenCode tools on your computer**, over a local connection (127.0.0.1). It accepts no other connections.
- OpenCode may send it to the AI model provider **you** configured in OpenCode, under that provider's terms. The extension itself doesn't choose or contact any provider.

Anomaly, the maker of OpenCode, doesn't run a server for this extension and doesn't receive, sell, or share your data. There's no analytics or tracking.

## Your choices
- Agents can't use your tabs unless you click the toolbar button on them. Click again to take a tab back.
- Remove the extension and run `npx opencode-browser-cli uninstall` to delete everything it set up.

## Contact
Questions: open an issue at https://github.com/anomalyco/opencode.
