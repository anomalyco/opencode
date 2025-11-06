---
title: CLI
description: OpenCode CLI options and commands.
---

import { Tabs, TabItem } from "@astrojs/starlight/components"

The OpenCode CLI by default starts the [TUI](/docs/tui) when run without any arguments.

```bash
opencode
```

But it also accepts commands as documented on this page. This allows you to interact with OpenCode programmatically.

```bash
opencode run "Explain how closures work in JavaScript"
```

---

### tui

Start the OpenCode terminal user interface.

```bash
opencode [project]
```

#### Flags

| Flag         | Short | Description                                |
| ------------ | ----- | ------------------------------------------ |
| `--continue` | `-c`  | Continue the last session                  |
| `--session`  | `-s`  | Session ID to continue                     |
| `--prompt`   | `-p`  | Prompt to use                              |
| `--model`    | `-m`  | Model to use in the form of provider/model |
| `--agent`    |       | Agent to use                               |
| `--port`     |       | Port to listen on                          |
| `--hostname` |       | Hostname to listen on                      |

---

## Commands

The OpenCode CLI also has the following commands.

---

### agent

Manage agents for OpenCode.

```bash
opencode agent [command]
```

---

#### create

Create a new agent with custom configuration.

```bash
opencode agent create
```

This command will guide you through creating a new agent with a custom system prompt and tool configuration.

---

### auth

Command to manage credentials and login for providers.

```bash
opencode auth [command]
```

---

#### login

OpenCode is powered by the provider list at [Models.dev](https://models.dev), so you can use `opencode auth login` to configure API keys for any provider you'd like to use. This is stored in `~/.local/share/opencode/auth.json`.

```bash
opencode auth login
```

When OpenCode starts up it loads the providers from the credentials file. And if there are any keys defined in your environments or a `.env` file in your project.

---

#### list

Lists all the authenticated providers as stored in the credentials file.

```bash
opencode auth list
```

Or the short version.

```bash
opencode auth ls
```

---

#### logout

Logs you out of a provider by clearing it from the credentials file.

```bash
opencode auth logout
```

---

### github

Manage the GitHub agent for repository automation.

```bash
opencode github [command]
```

---

#### install

Install the GitHub agent in your repository.

```bash
opencode github install
```

This sets up the necessary GitHub Actions workflow and guides you through the configuration process. [Learn more](/docs/github).

---

#### run

Run the GitHub agent. This is typically used in GitHub Actions.

```bash
opencode github run
```

##### Flags

| Flag      | Description                            |
| --------- | -------------------------------------- |
| `--event` | GitHub mock event to run the agent for |
| `--token` | GitHub personal access token           |

---

### models

List all available models from configured providers.

```bash
opencode models
```

This command displays all models available across your configured providers in the format `provider/model`.

This is useful for figuring out the exact model name to use in [your config](/docs/config/).

---

### run

Run opencode in non-interactive mode by passing a prompt directly.

```bash
opencode run [message..]
```

This is useful for scripting, automation, or when you want a quick answer without launching the full TUI. For example.

```bash "opencode run"
opencode run Explain the use of context in Go
```

You can also attach to a running `opencode serve` instance to avoid MCP server cold boot times on every run:

```bash
# Start a headless server in one terminal
opencode serve

# In another terminal, run commands that attach to it
opencode run --attach http://localhost:4096 "Explain async/await in JavaScript"
```

#### Flags

| Flag         | Short | Description                                                        |
| ------------ | ----- | ------------------------------------------------------------------ |
| `--command`  |       | The command to run, use message for args                           |
| `--continue` | `-c`  | Continue the last session                                          |
| `--session`  | `-s`  | Session ID to continue                                             |
| `--share`    |       | Share the session                                                  |
| `--model`    | `-m`  | Model to use in the form of provider/model                         |
| `--agent`    |       | Agent to use                                                       |
| `--file`     | `-f`  | File(s) to attach to message                                       |
| `--format`   |       | Format: default (formatted) or json (raw JSON events)              |
| `--title`    |       | Title for the session (uses truncated prompt if no value provided) |
| `--attach`   |       | Attach to a running opencode server (e.g., http://localhost:4096)  |
| `--port`     |       | Port for the local server (defaults to random port)                |

---

### serve

Start a headless opencode server for API access. Check out the [server docs](/docs/server) for the full HTTP interface.

```bash
opencode serve
```

This starts an HTTP server that provides API access to opencode functionality without the TUI interface.

#### Flags

| Flag         | Short | Description           |
| ------------ | ----- | --------------------- |
| `--port`     | `-p`  | Port to listen on     |
| `--hostname` |       | Hostname to listen on |

---

### upgrade

Updates opencode to the latest version or a specific version.

```bash
opencode upgrade [target]
```

To upgrade to the latest version.

```bash
opencode upgrade
```

To upgrade to a specific version.

```bash
opencode upgrade v0.1.48
```

#### Flags

| Flag       | Short | Description                                                       |
| ---------- | ----- | ----------------------------------------------------------------- |
| `--method` | `-m`  | The installation method that was used; curl, npm, pnpm, bun, brew |

---

## Global Flags

The opencode CLI takes the following global flags.

| Flag           | Short | Description                          |
| -------------- | ----- | ------------------------------------ |
| `--help`       | `-h`  | Display help                         |
| `--version`    | `-v`  | Print version number                 |
| `--print-logs` |       | Print logs to stderr                 |
| `--log-level`  |       | Log level (DEBUG, INFO, WARN, ERROR) |
