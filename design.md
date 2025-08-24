I've successfully implemented the shell functionality for your opencode
  tool. Here's what was done:

  Features Implemented:

  1. Direct Shell Execution - In Shell mode, commands bypass the AI agent
  and execute directly in the shell
  2. Auto Mode Detection - Automatically detects common shell commands and
   executes them directly
  3. CD Command Support - The cd command now properly changes and tracks
  the working directory
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
  - In Auto Mode: Input is analyzed to detect shell commands (using common
   patterns and command names)
  - In Agent Mode: All input goes to the AI agent
  - CD commands append pwd to capture the new directory and update the
  state
  - The working directory persists across commands in the same session