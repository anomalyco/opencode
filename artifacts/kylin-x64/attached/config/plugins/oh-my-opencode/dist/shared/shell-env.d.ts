export type ShellType = "unix" | "powershell" | "cmd" | "csh";
/**
 * Detect the current shell type based on environment variables.
 *
 * Detection priority:
 * 1. SHELL env var → Unix shell (explicit user choice takes precedence)
 * 2. PSModulePath → PowerShell
 * 3. Platform fallback → win32: cmd, others: unix
 *
 * Note: SHELL is checked before PSModulePath because on Windows, PSModulePath
 * is always set by the system even when the active shell is Git Bash or WSL.
 * An explicit SHELL variable indicates the user's chosen shell overrides that.
 */
export declare function detectShellType(): ShellType;
/**
 * Shell-escape a value for use in environment variable assignment.
 *
 * @param value - The value to escape
 * @param shellType - The target shell type
 * @returns Escaped value appropriate for the shell
 */
export declare function shellEscape(value: string, shellType: ShellType): string;
/**
 * Build environment variable prefix command for the target shell.
 *
 * @param env - Record of environment variables to set
 * @param shellType - The target shell type
 * @returns Command prefix string to prepend to the actual command
 *
 * @example
 * ```ts
 * // Unix: "export VAR1=val1 VAR2=val2; command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "unix")
 * // => "export VAR1=val1 VAR2=val2;"
 *
 * // PowerShell: "$env:VAR1='val1'; $env:VAR2='val2'; command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "powershell")
 * // => "$env:VAR1='val1'; $env:VAR2='val2';"
 *
 * // cmd.exe: "set VAR1=val1 && set VAR2=val2 && command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "cmd")
 * // => "set VAR1=\"val1\" && set VAR2=\"val2\" &&"
 * ```
 */
export declare function buildEnvPrefix(env: Record<string, string>, shellType: ShellType): string;
/**
 * Escape a value for use in a double-quoted shell -c command argument.
 *
 * In shell -c "..." strings, these characters have special meaning and must be escaped:
 * - $ - variable expansion, command substitution $(...)
 * - ` - command substitution `...`
 * - \\ - escape character
 * - " - end quote
 * - ; | & - command separators
 * - # - comment
 * - () - grouping operators
 *
 * @param value - The value to escape
 * @returns Escaped value safe for double-quoted shell -c argument
 *
 * @example
 * ```ts
 * // For malicious input
 * const url = "http://localhost:3000'; cat /etc/passwd; echo '"
 * const escaped = shellEscapeForDoubleQuotedCommand(url)
 * // => "http://localhost:3000'\''; cat /etc/passwd; echo '"
 *
 * // Usage in command:
 * const cmd = `/bin/sh -c "opencode attach ${escaped} --session ${sessionId}"`
 * ```
 */
export declare function shellEscapeForDoubleQuotedCommand(value: string): string;
