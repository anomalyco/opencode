---
title: Installation
description: Install Bun with npm, Homebrew, Docker, or the official script.
---

## Overview

Bun ships as a single, dependency-free executable. You can install it via script, package manager, or Docker across macOS, Linux, and Windows.

<Tip>After installation, verify with `bun --version` and `bun --revision`.</Tip>

## Installation

<Tabs>
  <Tab title="macOS & Linux">

    <CodeGroup>
      ```bash curl icon="globe"
      curl -fsSL https://bun.com/install | bash
      ```

    </CodeGroup>
    <Note>
      **Linux users**  The `unzip` package is required to install Bun. Use `sudo apt install unzip` to install the unzip package. Kernel version 5.6 or higher is recommended; Bun runs on kernels as old as 3.10 (RHEL 7) with graceful degradation of newer syscalls. Use `uname -r` to check your kernel version.
      </Note>

  </Tab>

  <Tab title="Windows">
    <CodeGroup>
      ```powershell PowerShell icon="terminal"
      powershell -c "irm bun.sh/install.ps1|iex"
      ```

    </CodeGroup>
    <Warning>
      Bun requires Windows 10 version 1809 or later.
    </Warning>


    For support and discussion, please join the **#windows** channel on our [Discord](https://bun.com/discord).

  </Tab>

    <Tab title="Package Managers">
    	<CodeGroup>

    	```bash npm icon="npm"
    	npm install -g bun # the last `npm` command you'll ever need
    	```

    	```bash Homebrew icon="/icons/homebrew.svg"
    	brew install oven-sh/bun/bun
    	```

    	```bash Scoop icon="terminal"
    	scoop install bun
    	```

    	</CodeGroup>

    </Tab>

  <Tab title="Docker">
    Bun provides a Docker image that supports both Linux x64 and arm64.

    ```bash Docker icon="docker"
    docker pull oven/bun
    docker run --rm --init --ulimit memlock=-1:-1 oven/bun
    ```

    ### Image Variants

    There are also image variants for different operating systems:

    ```bash Docker icon="docker"
    docker pull oven/bun:debian
    docker pull oven/bun:slim
    docker pull oven/bun:distroless
    docker pull oven/bun:alpine
    ```

  </Tab>
</Tabs>

To check that Bun was installed successfully, open a new terminal window and run:

```bash terminal icon="terminal"
bun --version
# Output: 1.x.y

# See the precise commit of `oven-sh/bun` that you're using
bun --revision
# Output: 1.x.y+b7982ac13189
```

<Warning>
  If you've installed Bun but are seeing a `command not found` error, you may have to manually add the installation
  directory (`~/.bun/bin`) to your `PATH`.
</Warning>

<Accordion title="Add Bun to your PATH">
  <Tabs>
    <Tab title="macOS & Linux">
      <Steps>
        <Step title="Determine which shell you're using">
        ```bash terminal icon="terminal"
        echo $SHELL
        # /bin/zsh  or /bin/bash or /bin/fish
        ```
        </Step>
        <Step title="Open your shell configuration file">
          - For bash: `~/.bashrc`
          - For zsh: `~/.zshrc`
          - For fish: `~/.config/fish/config.fish`
        </Step>
        
        <Step title="Add the Bun directory to PATH">
          Add this line to your configuration file:
          ```bash terminal icon="terminal"
          export BUN_INSTALL="$HOME/.bun"
          export PATH="$BUN_INSTALL/bin:$PATH"
          ```
        </Step>
        
        <Step title="Reload your shell configuration">
          ```bash terminal icon="terminal"
          source ~/.bashrc  # or ~/.zshrc
          ```
        </Step>
      </Steps>
    </Tab>
    <Tab title="Windows">
      <Steps>
        <Step title="Determine if the bun binary is properly installed">
        ```bash terminal icon="terminal"
        & "$env:USERPROFILE\.bun\bin\bun" --version
        ```

        If the command runs successfully but `bun --version` is not recognized, it means that bun is not in your system's PATH. To fix this, open a Powershell terminal and run the following command:

        ```bash terminal icon="terminal"
        [System.Environment]::SetEnvironmentVariable(
          "Path",
          [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.bun\bin",
          [System.EnvironmentVariableTarget]::User
        )
        ```

        </Step>
        <Step title="Restart your terminal">
           After running the command, restart your terminal and test with `bun --version`

          ```bash terminal icon="terminal"
          bun --version
          ```
        </Step>
      </Steps>
    </Tab>

  </Tabs>
</Accordion>

---

## Upgrading

Once installed, the binary can upgrade itself:

```bash terminal icon="terminal"
bun upgrade
```

<Tip>
**Homebrew users** <br />
To avoid conflicts with Homebrew, use `brew upgrade bun` instead.

**Scoop users** <br />
To avoid conflicts with Scoop, use `scoop update bun` instead.

</Tip>

---

## Canary Builds

[-> View canary build](https://github.com/oven-sh/bun/releases/tag/canary)

Bun automatically releases an (untested) canary build on every commit to main. To upgrade to the latest canary build:

```bash terminal icon="terminal"
# Upgrade to latest canary
bun upgrade --canary

# Switch back to stable
bun upgrade --stable
```

The canary build is useful for testing new features and bug fixes before they're released in a stable build. To help the Bun team fix bugs faster, canary builds automatically upload crash reports to Bun's team.

---

## Installing Older Versions

Since Bun is a single binary, you can install older versions by re-running the installer script with a specific version.

<Tabs>
  <Tab title="Linux & macOS">
    To install a specific version, pass the git tag to the install script:

    ```bash terminal icon="terminal"
    curl -fsSL https://bun.com/install | bash -s "bun-v1.3.3"
    ```

  </Tab>
  <Tab title="Windows">
    On Windows, pass the version number to the PowerShell install script:

    ```powershell PowerShell icon="windows"
    iex "& {$(irm https://bun.com/install.ps1)} -Version 1.3.3"
    ```

  </Tab>
</Tabs>

---

## Direct Downloads

To download Bun binaries directly, visit the [releases page on GitHub](https://github.com/oven-sh/bun/releases).

### Latest Version Downloads

<CardGroup cols={2}>
  <Card
    icon="/icons/linux.svg"
    title="Linux x64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip"
  >
    Standard Linux x64 binary
  </Card>
  <Card
    icon="/icons/linux.svg"
    title="Linux x64 Baseline"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-baseline.zip"
  >
    For older CPUs without AVX2
  </Card>
  <Card
    icon="/icons/windows.svg"
    title="Windows x64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip"
  >
    Standard Windows binary
  </Card>
  <Card
    icon="/icons/windows.svg"
    title="Windows x64 Baseline"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64-baseline.zip"
  >
    For older CPUs without AVX2
  </Card>
  <Card
    icon="/icons/windows.svg"
    title="Windows ARM64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-windows-aarch64.zip"
  >
    Windows on ARM (Snapdragon, etc.)
  </Card>
  <Card
    icon="/icons/apple.svg"
    title="macOS ARM64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-aarch64.zip"
  >
    Apple Silicon (M1/M2/M3)
  </Card>
  <Card
    icon="/icons/apple.svg"
    title="macOS x64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-x64.zip"
  >
    Intel Macs
  </Card>
  <Card
    icon="/icons/linux.svg"
    title="Linux ARM64"
    href="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64.zip"
  >
    ARM64 Linux systems
  </Card>
</CardGroup>

### Musl Binaries

For distributions without `glibc` (Alpine Linux, Void Linux):

- [Linux x64 musl](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-musl.zip)
- [Linux x64 musl baseline](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-musl-baseline.zip)
- [Linux ARM64 musl](https://github.com/oven-sh/bun/releases/latest/download/bun-linux-aarch64-musl.zip)

<Note>
  Bun's glibc binaries require glibc 2.17 or newer. If you encounter an error like `bun:
  /lib/x86_64-linux-gnu/libc.so.6: version GLIBC_... not found`, try using the musl binary. Bun's install script
  automatically chooses the correct binary for your system.
</Note>

---

## CPU Requirements

Bun has specific CPU requirements based on the binary you're using:

<Tabs>
	<Tab title="Standard Builds">
		**x64 binaries** target the Haswell CPU architecture (AVX and AVX2 instructions required)
    | Platform | Intel Requirement | AMD Requirement |
		|----------|-------------------|-----------------| 
    | x64 | Haswell (4th gen Core) or newer | Excavator or newer |
	</Tab>

    <Tab title="Baseline Builds">
    	**x64-baseline binaries** target the Nehalem architecture for older CPUs
    | Platform | Intel Requirement | AMD Requirement |
    |----------|-------------------|-----------------|
    | x64-baseline | Nehalem (1st gen Core) or newer | Bulldozer or newer |

    	<Warning>
    		Baseline builds are slower than regular builds. Use them only if you encounter an "Illegal
    		Instruction" error.
    	</Warning>
    </Tab>

</Tabs>

<Note>
  Bun does not support CPUs older than the baseline target, which mandates the SSE4.2 extension. macOS requires version
  13.0 or later.
</Note>

---

## Uninstall

To remove Bun from your system:

<Tabs>
	<Tab title="macOS & Linux">
  ```bash terminal icon="terminal"
  rm -rf ~/.bun
  ```
  </Tab>

    <Tab title="Windows">
    	```powershell PowerShell icon="windows"
    powershell -c ~\.bun\uninstall.ps1
    ```
    </Tab>

    <Tab title="Package Managers">
    	<CodeGroup>
    		```bash npm icon="npm"
      npm uninstall -g bun
      ```
      ```bash Homebrew icon="/icons/homebrew.svg"
      brew uninstall bun
      ```
      ```bash Scoop icon="terminal"
      scoop uninstall bun
      ```
    	</CodeGroup>
    </Tab>

</Tabs>
