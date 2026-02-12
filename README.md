<p align="center">
  <a href="https://mammouth.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logotype.svg" media="(prefers-color-scheme: dark)">
      <img src="packages/console/app/src/asset/logotype.svg" alt="Mammouth AI logo">
    </picture>
  </a>
</p>
<p align="center">Mammouth AI coding agent.</p>

[![Mammouth Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://info.mammouth.ai/docs/mammouth-code/)

---

### Installation

Linux/Mac/WSL:
```bash
curl -fsSL https://code.mammouth.ai/install.sh | bash
```

Windows (Powershell):
```ps1
irm "https://code.mammouth.ai/install.ps1" | iex
```

#### Installation Directory

The install script installs Mammouth Code to `$HOME/.mammouth/bin`.

The install script will add this directory to your `PATH` on your shell profile (`.bashrc`, `.zshrc`, etc.) if it's not already included. You will need to restart your terminal or run `source ~/<your appropriate profile file>` for the changes to take effect.

### Agents

Mammouth Code includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

### Documentation

For more info on how to configure Mammouth Code, [**head over to our docs**](https://info.mammouth.ai/).

### Building on Mammouth Code

If you are working on a project that's related to Mammouth Code and is using "mammouth" as part of its name, for example "mammouth-dashboard" or "mammouth-mobile", please add a note to your README to clarify that it is not built by the Mammouth Code team and is not affiliated with us in any way.

### FAQ

#### Is this just not a fork of OpenCode, but forcing a private provider?

Yes, that's exactly what it is. It also serves as an easy way for our users to setup a local agent that can connect to our hosted API, and also allows us to add features that are specific to our API and not available to just using OpenCode with Mammouth API as a custom provider.

---

**Join our community** [Discord](https://discord.gg/YJg2kX77M3)
