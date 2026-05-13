export interface CommandResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
export interface ExecuteHookOptions {
    forceZsh?: boolean;
    zshPath?: string;
    /** Timeout in milliseconds. Process is killed after this. Default: 30000 */
    timeoutMs?: number;
}
export declare function executeHookCommand(command: string, stdin: string, cwd: string, options?: ExecuteHookOptions): Promise<CommandResult>;
