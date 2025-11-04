 # Technical Reference Document: Parallel Mode Workflow                                                                                                                                      │
 │                                                                                                                                                                                             │
 │ ## Overview                                                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │ Parallel mode enables Kilo Code to work on isolated git worktrees, allowing multiple instances to operate simultaneously without conflicts. This feature creates a separate branch and      │
 │ worktree for each parallel session, commits changes automatically, and provides clean merge instructions.                                                                                   │
 │                                                                                                                                                                                             │
 │ ## Architecture Components                                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ ### Core Components                                                                                                                                                                         │
 │                                                                                                                                                                                             │
 │     * CLI Entry Point (cli/src/index.ts): Parses --parallel flag and validates options                                                                                                      │
 │     * Parallel Mode Manager (cli/src/parallel/parallel.ts): Orchestrates worktree lifecycle                                                                                                 │
 │     * Branch Manager (cli/src/parallel/determineBranch.ts): Handles git branch and worktree creation                                                                                        │
 │     * CLI Orchestrator (cli/src/cli.ts): Manages application lifecycle and cleanup                                                                                                          │
 │     * UI Components (cli/src/ui/): Handle parallel mode state and user interactions                                                                                                         │
 │     * Telemetry Service (cli/src/services/telemetry/): Tracks parallel mode events                                                                                                          │
 │                                                                                                                                                                                             │
 │ ### Key Dependencies                                                                                                                                                                        │
 │                                                                                                                                                                                             │
 │     * simple-git: Git operations and worktree management                                                                                                                                    │
 │     * jotai: State management for parallel mode flags                                                                                                                                       │
 │     * ink: Terminal UI rendering                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │ ## Workflow Diagram                                                                                                                                                                         │
 │                                                                                                                                                                                             │
 │     graph TD                                                                                                                                                                                │
 │         A[CLI Start] --> B{--parallel flag?}                                                                                                                                                │
 │         B -->|No| C[Normal Mode]                                                                                                                                                            │
 │         B -->|Yes| D[Parse Parallel Options]                                                                                                                                                │
 │                                                                                                                                                                                             │
 │         D --> E{Validate Options}                                                                                                                                                           │
 │         E -->|Invalid| F[Exit with Error]                                                                                                                                                   │
 │         E -->|Valid| G[Check Git Repository]                                                                                                                                                │
 │                                                                                                                                                                                             │
 │         G -->|Not Git Repo| H[Exit: Not Git Repository]                                                                                                                                     │
 │         G -->|Valid Repo| I[Determine Branch Strategy]                                                                                                                                      │
 │                                                                                                                                                                                             │
 │         I --> J{--existing-branch?}                                                                                                                                                         │
 │         J -->|Yes| K[Validate Existing Branch]                                                                                                                                              │
 │         J -->|No| L[Generate Branch Name from Prompt]                                                                                                                                       │
 │                                                                                                                                                                                             │
 │         K -->|Invalid Branch| M[Exit: Branch Not Found]                                                                                                                                     │
 │         K -->|Valid Branch| N[Create Worktree]                                                                                                                                              │
 │         L --> N                                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         N --> O[Worktree Created Successfully?]                                                                                                                                             │
 │         O -->|No| P[Exit: Worktree Creation Failed]                                                                                                                                         │
 │         O -->|Yes| Q[Switch to Worktree Workspace]                                                                                                                                          │
 │                                                                                                                                                                                             │
 │         Q --> R[Initialize CLI in Worktree]                                                                                                                                                 │
 │         R --> S[Execute Prompt/Task]                                                                                                                                                        │
 │         S --> T[Task Completion]                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │         T --> U[Stage All Changes]                                                                                                                                                          │
 │         U --> V{Changes Staged?}                                                                                                                                                            │
 │         V -->|No Changes| W[No Commit Needed]                                                                                                                                               │
 │         V -->|Changes Present| X[Request AI Commit Message]                                                                                                                                 │
 │                                                                                                                                                                                             │
 │         X --> Y[Send Agent Commit Instruction]                                                                                                                                              │
 │         Y --> Z[Wait for Commit Completion]                                                                                                                                                 │
 │         Z --> AA{Commit Timeout?}                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │         AA -->|Timeout| BB[Use Fallback Commit]                                                                                                                                             │
 │         AA -->|Success| CC[Agent Commit Complete]                                                                                                                                           │
 │         BB --> CC                                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │         CC --> DD[Print Success Message]                                                                                                                                                    │
 │         DD --> EE[Remove Worktree]                                                                                                                                                          │
 │         EE --> FF[Worktree Cleanup Success?]                                                                                                                                                │
 │                                                                                                                                                                                             │
 │         FF -->|Failed| GG[Warn: Cleanup Failed]                                                                                                                                             │
 │         FF -->|Success| HH[Exit with Success]                                                                                                                                               │
 │         GG --> HH                                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │         W --> DD                                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │         C --> II[Normal Execution]                                                                                                                                                          │
 │         II --> JJ[Exit Normally]                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │ ## Detailed Workflow Phases                                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │ ### Phase 1: CLI Flag Parsing and Validation                                                                                                                                                │
 │                                                                                                                                                                                             │
 │ Entry Point: cli/src/index.ts (lines 33-131)                                                                                                                                                │
 │                                                                                                                                                                                             │
 │ Process:                                                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │     1. Parse --parallel flag and optional --existing-branch <branch>                                                                                                                        │
 │     2. Validate mutually exclusive options:                                                                                                                                                 │
 │         * --existing-branch requires --parallel                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         * Autonomous mode requires prompt argument                                                                                                                                          │
 │     3. Validate workspace exists and is accessible                                                                                                                                          │
 │     4. Check git repository status                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │ Validation Rules:                                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │     // --existing-branch requires --parallel                                                                                                                                                │
 │     if (options.existingBranch && !options.parallel) {                                                                                                                                      │
 │         console.error("Error: --existing-branch option requires --parallel flag to be enabled")                                                                                             │
 │         process.exit(1)                                                                                                                                                                     │
 │     }                                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │     // Autonomous mode requires prompt                                                                                                                                                      │
 │     if (options.auto && !finalPrompt) {                                                                                                                                                     │
 │         console.error("Error: autonomous mode (--auto) and parallel mode (--parallel) require a prompt argument or piped input")                                                            │
 │         process.exit(1)                                                                                                                                                                     │
 │     }                                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │ Error Paths:                                                                                                                                                                                │
 │                                                                                                                                                                                             │
 │     * Invalid mode combination → Exit code 1                                                                                                                                                │
 │     * Non-existent workspace → Exit code 1                                                                                                                                                  │
 │     * Missing prompt in auto mode → Exit code 1                                                                                                                                             │
 │                                                                                                                                                                                             │
 │ ### Phase 2: Git Repository and Branch Setup                                                                                                                                                │
 │                                                                                                                                                                                             │
 │ Entry Point: cli/src/parallel/parallel.ts::getParallelModeParams() (lines 63-87)                                                                                                            │
 │                                                                                                                                                                                             │
 │ Process:                                                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │     1. Validate current directory is git repository                                                                                                                                         │
 │     2. Determine branch strategy based on --existing-branch flag                                                                                                                            │
 │     3. Generate or validate branch name                                                                                                                                                     │
 │     4. Create git worktree in system temp directory                                                                                                                                         │
 │                                                                                                                                                                                             │
 │ Branch Name Generation (cli/src/utils/git.ts::generateBranchName()):                                                                                                                        │
 │                                                                                                                                                                                             │
 │     export function generateBranchName(prompt: string): string {                                                                                                                            │
 │         const sanitized = prompt                                                                                                                                                            │
 │             .slice(0, 50)                                                                                                                                                                   │
 │             .toLowerCase()                                                                                                                                                                  │
 │             .replace(/[^a-z0-9]+/g, "-")                                                                                                                                                    │
 │             .replace(/^-+|-+$/g, "")                                                                                                                                                        │
 │             .replace(/-+/g, "-")                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │         const timestamp = Date.now()                                                                                                                                                        │
 │         return `${sanitized || "kilo"}-${timestamp}`                                                                                                                                        │
 │     }                                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │ Worktree Creation:                                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │     * Location: {os.tmpdir()}/kilocode-worktree-{branchName}                                                                                                                                │
 │     * Commands:                                                                                                                                                                             │
 │         * New branch: git worktree add -b {branch} {path}                                                                                                                                   │
 │                                                                                                                                                                                             │
 │         * Existing branch: git worktree add {path} {branch}                                                                                                                                 │
 │                                                                                                                                                                                             │
 │ Error Paths:                                                                                                                                                                                │
 │                                                                                                                                                                                             │
 │     * Not a git repository → Exit code 1                                                                                                                                                    │
 │     * Branch doesn't exist (when using --existing-branch) → Exit code 1                                                                                                                     │
 │     * Worktree creation failure → Exit code 1                                                                                                                                               │
 │                                                                                                                                                                                             │
 │ ### Phase 3: Workspace Switching and Execution                                                                                                                                              │
 │                                                                                                                                                                                             │
 │ Entry Point: cli/src/cli.ts (lines 62-66, 181-184)                                                                                                                                          │
 │                                                                                                                                                                                             │
 │ Process:                                                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │     1. Switch CLI workspace to worktree path                                                                                                                                                │
 │     2. Update terminal title to show worktree context                                                                                                                                       │
 │     3. Initialize extension service in worktree                                                                                                                                             │
 │     4. Execute user prompt/task                                                                                                                                                             │
 │     5. Monitor for completion                                                                                                                                                               │
 │                                                                                                                                                                                             │
 │ Workspace Context Updates:                                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │     // Terminal title shows original directory in parallel mode                                                                                                                             │
 │     const titleWorkspace = this.options.parallel ? process.cwd() : this.options.workspace || process.cwd()                                                                                  │
 │     process.stdout.write(`\x1b]0;Kilo Code - ${folderName}\x07`)                                                                                                                            │
 │                                                                                                                                                                                             │
 │ UI State Management (cli/src/ui/UI.tsx lines 102-107):                                                                                                                                      │
 │                                                                                                                                                                                             │
 │     // Set parallel mode flag in UI state                                                                                                                                                   │
 │     useEffect(() => {                                                                                                                                                                       │
 │         if (options.parallel) {                                                                                                                                                             │
 │             setIsParallelMode(true)                                                                                                                                                         │
 │         }                                                                                                                                                                                   │
 │     }, [options.parallel, setIsParallelMode])                                                                                                                                               │
 │                                                                                                                                                                                             │
 │ ### Phase 4: Commit Generation and Cleanup                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ Entry Point: cli/src/parallel/parallel.ts::finishParallelMode() (lines 98-200)                                                                                                              │
 │                                                                                                                                                                                             │
 │ Process:                                                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │     1. Check for uncommitted changes: git status                                                                                                                                            │
 │     2. Stage all changes: git add -A                                                                                                                                                        │
 │     3. Generate diff: git diff --staged                                                                                                                                                     │
 │     4. If changes exist, instruct AI agent to commit                                                                                                                                        │
 │     5. Wait for commit completion with timeout                                                                                                                                              │
 │     6. Clean up worktree: git worktree remove {path}                                                                                                                                        │
 │     7. Display success message with merge instructions                                                                                                                                      │
 │                                                                                                                                                                                             │
 │ Agent Commit Instruction:                                                                                                                                                                   │
 │                                                                                                                                                                                             │
 │     "Inspect the git diff and commit all staged changes with a proper conventional commit message (e.g., 'feat:', 'fix:', 'chore:', etc.). Use execute_command to run 'git diff --staged',  │
 │ then commit with an appropriate message using 'git commit -m \"your-message\"'."                                                                                                            │
 │                                                                                                                                                                                             │
 │ Commit Completion Monitoring (waitForCommitCompletion()):                                                                                                                                   │
 │                                                                                                                                                                                             │
 │     * Polls git diff --staged every 1 second                                                                                                                                                │
 │     * Timeout: 40 seconds (commitCompletionTimeout)                                                                                                                                         │
 │     * Success: No staged changes remain                                                                                                                                                     │
 │     * Fallback: Uses generic commit message if agent fails                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ Success Message Format:                                                                                                                                                                     │
 │                                                                                                                                                                                             │
 │     ✓ Parallel mode complete! Changes committed to: {branchName}                                                                                                                            │
 │                                                                                                                                                                                             │
 │     Review and merge changes:                                                                                                                                                               │
 │       git diff {branchName}                                                                                                                                                                 │
 │       git merge {branchName}                                                                                                                                                                │
 │                                                                                                                                                                                             │
 │     💡 Tip: Resume work with --existing-branch:                                                                                                                                             │
 │       kilocode --parallel --existing-branch {branchName} "<prompt>"                                                                                                                         │
 │                                                                                                                                                                                             │
 │ ### Phase 5: Error Handling and Recovery                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │ Error Categories:                                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │     1. Setup Errors (Pre-execution):                                                                                                                                                        │
 │                                                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         * Git repository validation failure                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │         * Branch existence validation failure                                                                                                                                               │
 │                                                                                                                                                                                             │
 │         * Worktree creation failure                                                                                                                                                         │
 │                                                                                                                                                                                             │
 │         * Recovery: Exit with error code 1                                                                                                                                                  │
 │     2. Execution Errors (During task):                                                                                                                                                      │
 │                                                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         * Extension service failures                                                                                                                                                        │
 │                                                                                                                                                                                             │
 │         * Task execution failures                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │         * Recovery: Continue to commit phase if possible                                                                                                                                    │
 │     3. Commit Errors (Post-execution):                                                                                                                                                      │
 │                                                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         * Agent commit timeout                                                                                                                                                              │
 │                                                                                                                                                                                             │
 │         * Git operation failures                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │         * Recovery: Use fallback commit message                                                                                                                                             │
 │     4. Cleanup Errors (Post-commit):                                                                                                                                                        │
 │                                                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │         * Worktree removal failure                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │         * Recovery: Warn user but exit successfully                                                                                                                                         │
 │                                                                                                                                                                                             │
 │ Error Telemetry (cli/src/services/telemetry/events.ts):                                                                                                                                     │
 │                                                                                                                                                                                             │
 │     PARALLEL_MODE_STARTED = "cli_parallel_mode_started",                                                                                                                                    │
 │     PARALLEL_MODE_COMPLETED = "cli_parallel_mode_completed",                                                                                                                                │
 │     PARALLEL_MODE_ERRORED = "cli_parallel_mode_errored",                                                                                                                                    │
 │                                                                                                                                                                                             │
 │ ### Phase 6: User Interactions and Feedback                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │ Interactive Elements:                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │     * Welcome message shows worktree branch name                                                                                                                                            │
 │     * Status bar displays original directory path                                                                                                                                           │
 │     * Command input disabled during commit phase                                                                                                                                            │
 │     * Progress indicators for commit countdown                                                                                                                                              │
 │                                                                                                                                                                                             │
 │ UI State Atoms (cli/src/state/atoms/ui.ts):                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │     * isCommittingParallelModeAtom: Disables input during commit                                                                                                                            │
 │     * commitCountdownSecondsAtom: Shows countdown timer                                                                                                                                     │
 │     * isParallelModeAtom: Enables parallel-specific UI features                                                                                                                             │
 │                                                                                                                                                                                             │
 │ Terminal Title Updates:                                                                                                                                                                     │
 │                                                                                                                                                                                             │
 │     * Shows original workspace path in parallel mode                                                                                                                                        │
 │     * Indicates git worktree context: "Kilo Code - {folderName} (git worktree)"                                                                                                             │
 │                                                                                                                                                                                             │
 │ ## Configuration and Dependencies                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │ ### Required Permissions                                                                                                                                                                    │
 │                                                                                                                                                                                             │
 │     * Git repository access (read/write)                                                                                                                                                    │
 │     * Temporary directory access for worktrees                                                                                                                                              │
 │     * Network access for AI agent communication                                                                                                                                             │
 │                                                                                                                                                                                             │
 │ ### Environment Dependencies                                                                                                                                                                │
 │                                                                                                                                                                                             │
 │     * Node.js runtime                                                                                                                                                                       │
 │     * Git command-line tool                                                                                                                                                                 │
 │     * System temporary directory access                                                                                                                                                     │
 │                                                                                                                                                                                             │
 │ ### Configuration Validation                                                                                                                                                                │
 │                                                                                                                                                                                             │
 │     * Provider configuration must be valid                                                                                                                                                  │
 │     * Git repository must exist and be clean (for initial validation)                                                                                                                       │
 │     * Branch names must be valid git identifiers                                                                                                                                            │
 │                                                                                                                                                                                             │
 │ ## Performance Characteristics                                                                                                                                                              │
 │                                                                                                                                                                                             │
 │ ### Resource Usage                                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │     * Memory: Minimal additional overhead beyond normal CLI usage                                                                                                                           │
 │     * Disk: Temporary worktree storage (cleaned up automatically)                                                                                                                           │
 │     * Network: Standard AI agent communication                                                                                                                                              │
 │                                                                                                                                                                                             │
 │ ### Timing Characteristics                                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │     * Setup: < 2 seconds (git operations)                                                                                                                                                   │
 │     * Execution: Variable (depends on task complexity)                                                                                                                                      │
 │     * Commit: 40-second timeout for agent response                                                                                                                                          │
 │     * Cleanup: < 1 second (git worktree removal)                                                                                                                                            │
 │                                                                                                                                                                                             │
 │ ## Security Considerations                                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ ### Git Operations                                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │     * All git operations use validated, sanitized inputs                                                                                                                                    │
 │     * Branch names are sanitized to prevent command injection                                                                                                                               │
 │     * Worktree paths are generated in system temp directory                                                                                                                                 │
 │                                                                                                                                                                                             │
 │ ### Process Isolation                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │     * Each parallel instance runs in separate worktree                                                                                                                                      │
 │     * No shared state between parallel instances                                                                                                                                            │
 │     * Clean separation prevents conflicts                                                                                                                                                   │
 │                                                                                                                                                                                             │
 │ ## Monitoring and Observability                                                                                                                                                             │
 │                                                                                                                                                                                             │
 │ ### Telemetry Events                                                                                                                                                                        │
 │                                                                                                                                                                                             │
 │     * cli_parallel_mode_started: Branch creation, prompt length, timeout                                                                                                                    │
 │     * cli_parallel_mode_completed: Success confirmation                                                                                                                                     │
 │     * cli_parallel_mode_errored: Error details and context                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ ### Logging                                                                                                                                                                                 │
 │                                                                                                                                                                                             │
 │     * Debug logs for git operations                                                                                                                                                         │
 │     * Info logs for major workflow steps                                                                                                                                                    │
 │     * Error logs for failures with context                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │ ### Health Checks                                                                                                                                                                           │
 │                                                                                                                                                                                             │
 │     * Git repository validation                                                                                                                                                             │
 │     * Worktree creation verification                                                                                                                                                        │
 │     * Commit completion monitoring                                                                                                                                                          │
 │     * Cleanup success confirmation                                                                                                                                                          │
 │                                                                                                                                                                                             │
 │ ## Future Enhancements                                                                                                                                                                      │
 │                                                                                                                                                                                             │
 │ ### Potential Improvements                                                                                                                                                                  │
 │                                                                                                                                                                                             │
 │     1. Concurrent Execution: Allow multiple parallel instances to run simultaneously                                                                                                        │
 │     2. Branch Conflict Resolution: Automatic merge conflict handling                                                                                                                        │
 │     3. Custom Commit Templates: Configurable commit message formats                                                                                                                         │
 │     4. Worktree Persistence: Option to keep worktrees for debugging                                                                                                                         │
 │     5. Resource Limits: Configurable timeouts and resource constraints                                                                                                                      │
 │                                                                                                                                                                                             │
 │ ### Compatibility Considerations                                                                                                                                                            │
 │                                                                                                                                                                                             │
 │     * Git version requirements (worktree support)                                                                                                                                           │
 │     * Operating system temp directory behavior                                                                                                                                              │
 │     * File system permissions for worktree creation                                                                                                                                         │
 │                                                                                                                                                                                             │
 │ ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- │
 │ -----                                                                                                                                                                                       │
 │                                                                                                                                                                                             │
 │ This Technical Reference Document provides comprehensive coverage of the parallel mode workflow, including all decision points, error handling paths, and user interactions. The feature    │
 │ enables safe concurrent operation of multiple Kilo Code instances while maintaining git repository integrity and providing clear user feedback throughout the process.