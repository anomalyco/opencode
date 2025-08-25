

  Features:

  1. Direct Shell Execution - In Shell mode, commands bypass the AI agent
  and execute directly in the shell
  2. Auto Mode Detection - Executes commands if they are valid shell commands and falls back to AI.
  4. Current Directory Display - Shows the current working directory in
  the footer (abbreviated for long paths)
  5. Command History - Shell commands are added to history for navigation

  Key Changes Made:

  1. editor.go - Added shell command detection logic and routing based on
  ExecutionMode
  2. app.go - Added CurrentWorkingDir field to track the working directory
   and modified SendShell to handle cd commands
  3. tui.go - Added handling for cd command results to update the working
  directory
  4. Footer Display - Shows current directory in Shell/Auto modes with
  smart path abbreviation

  How It Works:

  - In Shell Mode: All input is executed as shell commands
  - In Auto Mode: Either execute a command if valid, if you are able to detect invalid and valid commands before running, or just try to run it and then fall back to agent if it fails.
  - In Agent Mode: All input goes to the AI agent
  - The working directory persists across commands in the same session