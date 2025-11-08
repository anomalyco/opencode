/**
 * PowerShell completion script generator for OpenCode CLI
 */

export namespace PowerShellCompletion {
  export function generate(): string {
    return `# OpenCode PowerShell completion script
# Add to your PowerShell profile ($PROFILE):
#   opencode completion powershell | Out-String | Invoke-Expression

using namespace System.Management.Automation
using namespace System.Management.Automation.Language

Register-ArgumentCompleter -Native -CommandName opencode -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @{
        'run' = 'Run opencode with a message'
        'spawn' = 'Start TUI server and client'
        'attach' = 'Connect to running server'
        'serve' = 'Start server component'
        'auth' = 'Manage API credentials'
        'models' = 'List available models'
        'agent' = 'Manage AI agents'
        'config' = 'Configuration management'
        'debug' = 'Diagnostic tools'
        'mcp' = 'Model Context Protocol'
        'export' = 'Export sessions'
        'import' = 'Import data'
        'stats' = 'Session statistics'
        'upgrade' = 'Update OpenCode'
        'web' = 'Start web interface'
        'github' = 'GitHub integration'
        'acp' = 'Agent Client Protocol'
        'generate' = 'Code generation'
        'thread' = 'Thread management'
        'completion' = 'Shell completion'
    }

    $authCommands = @{
        'login' = 'Authenticate with provider'
        'logout' = 'Remove credentials'
        'list' = 'Show providers'
    }

    $debugCommands = @{
        'config' = 'Inspect configuration'
        'lsp' = 'Debug LSP'
        'file' = 'Analyze files'
        'rg' = 'Test ripgrep'
        'snapshot' = 'Create snapshots'
    }

    $mcpCommands = @{
        'install' = 'Install MCP servers'
        'list' = 'List MCP servers'
    }

    $commonOptions = @{
        '--help' = 'Show help'
        '-h' = 'Show help'
        '--version' = 'Show version'
        '-v' = 'Show version'
        '--print-logs' = 'Print logs to stderr'
        '--log-level' = 'Set log level'
    }

    $runOptions = @{
        '--command' = 'Command to run'
        '--continue' = 'Continue last session'
        '-c' = 'Continue last session'
        '--session' = 'Session ID to continue'
        '-s' = 'Session ID'
        '--share' = 'Share the session'
        '--model' = 'Model to use'
        '-m' = 'Model to use'
        '--agent' = 'Agent to use'
        '--format' = 'Output format'
        '--file' = 'File(s) to attach'
        '-f' = 'File(s) to attach'
        '--title' = 'Session title'
        '--attach' = 'Server URL'
        '--port' = 'Local server port'
    }

    $serveOptions = @{
        '--port' = 'Server port'
        '--hostname' = 'Server hostname'
        '--no-tui' = 'Disable TUI'
    }

    # Parse command line to determine context
    $commandLine = $commandAst.ToString()
    $tokens = $commandLine.Split(' ')

    # Determine what to complete
    $mainCommand = if ($tokens.Count -gt 1) { $tokens[1] } else { $null }
    $subCommand = if ($tokens.Count -gt 2) { $tokens[2] } else { $null }

    # Complete main command
    if ($tokens.Count -le 2 -and -not $wordToComplete.StartsWith('-')) {
        $commands.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
            [CompletionResult]::new($_.Key, $_.Key, 'ParameterValue', $_.Value)
        }
        return
    }

    # Complete subcommands
    if ($mainCommand -and $tokens.Count -le 3 -and -not $wordToComplete.StartsWith('-')) {
        switch ($mainCommand) {
            'auth' {
                $authCommands.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_.Key, $_.Key, 'ParameterValue', $_.Value)
                }
            }
            'debug' {
                $debugCommands.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_.Key, $_.Key, 'ParameterValue', $_.Value)
                }
            }
            'mcp' {
                $mcpCommands.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_.Key, $_.Key, 'ParameterValue', $_.Value)
                }
            }
            'completion' {
                @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "$_ shell completion")
                }
            }
        }
        return
    }

    # Complete options based on main command
    if ($wordToComplete.StartsWith('-')) {
        $optionsToShow = $commonOptions.Clone()

        switch ($mainCommand) {
            'run' { $runOptions.GetEnumerator() | ForEach-Object { $optionsToShow[$_.Key] = $_.Value } }
            'serve' { $serveOptions.GetEnumerator() | ForEach-Object { $optionsToShow[$_.Key] = $_.Value } }
        }

        $optionsToShow.GetEnumerator() | Where-Object { $_.Key -like "$wordToComplete*" } | ForEach-Object {
            [CompletionResult]::new($_.Key, $_.Key, 'ParameterName', $_.Value)
        }
        return
    }

    # Complete option values
    $prevToken = if ($tokens.Count -gt 1) { $tokens[$tokens.Count - 2] } else { $null }
    switch ($prevToken) {
        '--log-level' {
            @('DEBUG', 'INFO', 'WARN', 'ERROR') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_, $_, 'ParameterValue', "Log level: $_")
            }
        }
        '--format' {
            @('default', 'json') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_, $_, 'ParameterValue', "Format: $_")
            }
        }
        '--agent' {
            @('general', 'build', 'plan') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_, $_, 'ParameterValue', "Agent: $_")
            }
        }
        '--provider' {
            @('anthropic', 'openai', 'google', 'bedrock') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_, $_, 'ParameterValue', "Provider: $_")
            }
        }
        '--model' {
            @(
                'anthropic/claude-sonnet-4.5',
                'anthropic/claude-opus-4',
                'openai/gpt-4',
                'openai/gpt-4o',
                'google/gemini-pro'
            ) | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_, $_, 'ParameterValue', "Model: $_")
            }
        }
        { $_ -eq '--file' -or $_ -eq '-f' } {
            # Complete file paths
            Get-ChildItem -Path . -File | Where-Object { $_.Name -like "$wordToComplete*" } | ForEach-Object {
                [CompletionResult]::new($_.Name, $_.Name, 'ProviderItem', $_.FullName)
            }
        }
    }
}
`.trim()
  }
}
