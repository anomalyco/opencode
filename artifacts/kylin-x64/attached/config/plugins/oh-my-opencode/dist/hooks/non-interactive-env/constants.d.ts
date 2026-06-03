export declare const HOOK_NAME = "non-interactive-env";
export declare const NON_INTERACTIVE_ENV: Record<string, string>;
/**
 * Shell command guidance for non-interactive environments.
 * These patterns should be followed to avoid hanging on user input.
 */
export declare const SHELL_COMMAND_PATTERNS: {
    readonly npm: {
        readonly bad: readonly ["npm init", "npm install (prompts)"];
        readonly good: readonly ["npm init -y", "npm install --yes"];
    };
    readonly apt: {
        readonly bad: readonly ["apt-get install pkg"];
        readonly good: readonly ["apt-get install -y pkg", "DEBIAN_FRONTEND=noninteractive apt-get install pkg"];
    };
    readonly pip: {
        readonly bad: readonly ["pip install pkg (with prompts)"];
        readonly good: readonly ["pip install --no-input pkg", "PIP_NO_INPUT=1 pip install pkg"];
    };
    readonly git: {
        readonly bad: readonly ["git commit", "git merge branch", "git add -p", "git rebase -i"];
        readonly good: readonly ["git commit -m 'msg'", "git merge --no-edit branch", "git add .", "git rebase --no-edit"];
    };
    readonly system: {
        readonly bad: readonly ["rm file (prompts)", "cp a b (prompts)", "ssh host"];
        readonly good: readonly ["rm -f file", "cp -f a b", "ssh -o BatchMode=yes host", "unzip -o file.zip"];
    };
    readonly banned: readonly ["vim", "nano", "vi", "emacs", "less", "more", "man", "python (REPL)", "node (REPL)", "git add -p", "git rebase -i"];
    readonly workarounds: {
        readonly yesPipe: "yes | ./script.sh";
        readonly heredoc: "./script.sh <<EOF\noption1\noption2\nEOF";
        readonly expectAlternative: "Use environment variables or config files instead of expect";
    };
};
