## Mammouth Code

Mammouth Code is Mammouth AI's fork of [OpenCode](https://github.com/anomalyco/opencode), a terminal-based AI coding agent.

### Installation

Run the following command in your terminal:

```bash
curl -fsSL <https://code.mammouth.ai/install.sh> | bash
```

This works on macOS and Linux.

### Usage

1. Open the integrated terminal in your IDE of choice (VS Code, Cursor, WebStorm, etc.)
2. Navigate to your project directory
3. Run: `mammouth`

That's it — Mammouth Code will start an interactive session right in your terminal.

### Continue previous session

There are 2 ways of continuing a previous session.

- Run `mammouth` as you usually would and then use the `/sessions` command to switch to an old session
- Run `mammouth -c` to continue the previous session used on the current folder.

### Update

To update Mammouth Code, run the following command in your terminal:

```bash
mammouth update
```

This will fetch the latest version of Mammouth Code and install it on your system, replacing the old version while keeping your configurations and sessions intact.

### Uninstall

To uninstall Mammouth Code, run the following command in your terminal:

```bash
mammouth uninstall
```

This will completely remove Mammouth Code from your system, including configurations and sessions.
