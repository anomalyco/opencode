# OpenCode Browser privacy policy

_Last updated: October 2, 2026_

OpenCode Browser is a browser extension that connects your browser to OpenCode running on your own computer. This policy explains what it handles and where that goes.

## What the extension handles
- **Your messages and the pages you include** in the side panel chat.
- **Page content, screenshots, and actions** in tabs an agent opened or you shared with it.
- **Site scripts** you approved, and your settings.
- **History, bookmarks, top sites, and recently closed tabs**, only after you click Allow for a conversation and grant the browser permission.

## Where it goes
- To **OpenCode on your computer**, over a local connection (127.0.0.1) found through a helper you install with `npx opencode-browser-cli install`, and to the local Browser Control relay if you use it.
- OpenCode may send it to the AI model provider **you** configured in OpenCode, under that provider's terms. The extension itself doesn't choose or contact any provider.
- Settings, site scripts, and permissions are stored in your browser's extension storage.

Anomaly, the maker of OpenCode, doesn't run a server for this extension and doesn't receive, sell, or share your data. There's no analytics or tracking.

## Your choices
- Share only the tabs you want. Agents can't use other tabs.
- Deny or revoke access to browsing data at any time in the panel or the browser's extension settings.
- Remove the extension and run `npx opencode-browser-cli uninstall` to delete everything it set up.

## Contact
Questions: open an issue at https://github.com/anomalyco/opencode.
