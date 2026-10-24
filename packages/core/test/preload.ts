process.env.OPENCODE_DB = ":memory:"
process.env.NPM_CONFIG_AUDIT = "false"
// Shell selection prefers process.env.SHELL, which Git Bash sets to /usr/bin/bash.
// Tests hard-code PowerShell syntax for win32, so normalize to the CI-like default shell.
if (process.platform === "win32") delete process.env.SHELL
