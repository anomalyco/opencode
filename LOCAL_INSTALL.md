# Local Installation Guide

This guide shows how to install OpenCode from source for development or when you want to use the latest features that haven't been released yet.

## Prerequisites

- [Bun](https://bun.sh) runtime

## Installation

1.  **Clone and Install Dependencies**:

    ```bash
    git clone git@github.com:sst/opencode.git # currently only available on the following fork: git@github.com:jkorsvik/opencode.git
    cd opencode
    bun install
    ```

2.  **Build the Project**:
    This command builds all the packages in the monorepo, including the `opencode` CLI executable.

    ```bash
    bun turbo build
    ```

3.  **Install the CLI**:
    This will copy the executable you just built to the standard `opencode` binary location.

    First, ensure the destination directory exists:

    ```bash
    mkdir -p ~/.opencode/bin
    ```

    Next, find the correct binary for your system in the `packages/opencode/dist/` directory and copy it.
    - **macOS (Apple Silicon)**:
      ```bash
      cp packages/opencode/dist/opencode-darwin-arm64/bin/opencode ~/.opencode/bin/
      ```
    - **macOS (Intel)**:
      ```bash
      cp packages/opencode/dist/opencode-darwin-x64/bin/opencode ~/.opencode/bin/
      ```
    - **Linux**:
      ```bash
      cp packages/opencode/dist/opencode-linux-x64/bin/opencode ~/.opencode/bin/
      ```
    - **Windows**:
      Use File Explorer to copy the executable from `packages\opencode\dist\opencode-windows-x64\bin\opencode.exe` to `%USERPROFILE%\.opencode\bin\`.

4.  **Update your PATH**:
    Make sure the `~/.opencode/bin` directory is in your system's `PATH`. If you haven't done so before, add the following line to your shell's configuration file (e.g., `~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`).

    ```bash
    export PATH="$HOME/.opencode/bin:$PATH"
    ```

    You will need to restart your terminal or source the configuration file for this change to take effect.

5.  **Verify Installation**:
    ```bash
    opencode --version
    ```

## Development Mode

For active development, you can run OpenCode directly from the project root without installing:

```bash
# This runs the TUI in development mode
bun dev
```

## Updating

To update your local build with the latest changes from the repository:

```bash
cd opencode
git pull
bun install
bun turbo build
# Repeat step 3 from the installation instructions to copy the new binary
```

## Uninstalling

To remove the local installation, simply remove the executable and its directory:

```bash
rm -rf ~/.opencode
```

---

**Need help?** Join our [Discord community](https://discord.gg/opencode) or check the [main documentation](https://opencode.ai/docs).
