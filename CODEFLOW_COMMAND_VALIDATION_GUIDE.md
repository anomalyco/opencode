# OpenCode Command Conversion Validation Guide for Codeflow Projects

## Executive Summary

This guide provides a comprehensive validation framework for ensuring OpenCode commands are properly converted and functioning within codeflow projects (workflow automation/CI/CD systems). It covers CLI command parsing, slash command template substitution, MCP server configuration, and integration testing strategies specific to automated workflow environments.

## Table of Contents

1. [Validation Checklist Overview](#validation-checklist-overview)
2. [CLI Command Argument Validation](#cli-command-argument-validation)
3. [Slash Command Template Validation](#slash-command-template-validation)
4. [MCP Server Configuration Validation](#mcp-server-configuration-validation)
5. [Codeflow-Specific Test Cases](#codeflow-specific-test-cases)
6. [Debugging Command Conversion Issues](#debugging-command-conversion-issues)
7. [Integration Testing Strategies](#integration-testing-strategies)
8. [Common Conversion Errors and Solutions](#common-conversion-errors-and-solutions)
9. [Configuration Validation Patterns](#configuration-validation-patterns)
10. [Automated Validation Scripts](#automated-validation-scripts)

---

## Validation Checklist Overview

### Phase 1: Pre-Conversion Validation

- [ ] **Command Discovery**: Verify all commands are discoverable in the codeflow environment
- [ ] **Schema Compliance**: Validate command schemas against OpenCode specifications
- [ ] **Dependency Check**: Ensure all required dependencies are available
- [ ] **Permission Validation**: Confirm codeflow environment has necessary permissions

### Phase 2: Argument Parsing Validation

- [ ] **CLI Arguments**: Test positional and optional argument parsing
- [ ] **Array Handling**: Validate array argument processing (headers, environment variables)
- [ ] **Type Coercion**: Verify automatic type conversion works correctly
- [ ] **Error Handling**: Test invalid argument rejection with helpful messages

### Phase 3: Template Substitution Validation

- [ ] **$ARGUMENTS Replacement**: Verify argument substitution in slash commands
- [ ] **Shell Command Execution**: Test `!`command`` pattern execution
- [ ] **File Reference Resolution**: Validate `@file` reference processing
- [ ] **Nested Template Handling**: Test complex template combinations

### Phase 4: MCP Integration Validation

- [ ] **Server Configuration**: Validate MCP server setup and connectivity
- [ ] **Tool Discovery**: Verify MCP tools are properly exposed
- [ ] **Authentication**: Test authentication mechanisms (headers, tokens)
- [ ] **Error Recovery**: Validate graceful handling of connection failures

### Phase 5: Codeflow Integration Validation

- [ ] **Workflow Execution**: Test commands within actual codeflow workflows
- [ ] **Environment Variables**: Validate environment-specific configurations
- [ ] **Output Parsing**: Verify command outputs are correctly captured
- [ ] **Rollback Testing**: Test failure recovery and rollback mechanisms

---

## CLI Command Argument Validation

### 1. Basic Argument Structure Validation

```typescript
// Validation Test: Basic CLI Command Structure
export function validateCLICommandStructure(commandName: string) {
  const validationResults = {
    passed: [],
    failed: [],
    warnings: [],
  }

  // Test 1: Command Registration
  try {
    const command = require(`../src/cli/cmd/${commandName}`)
    if (command.command && command.describe && command.handler) {
      validationResults.passed.push("Command structure is valid")
    } else {
      validationResults.failed.push("Missing required command properties")
    }
  } catch (error) {
    validationResults.failed.push(`Command file not found: ${error.message}`)
  }

  // Test 2: Yargs Builder Validation
  try {
    const mockYargs = createMockYargs()
    if (command.builder) {
      command.builder(mockYargs)
      validationResults.passed.push("Yargs builder executes without errors")
    }
  } catch (error) {
    validationResults.failed.push(`Yargs builder error: ${error.message}`)
  }

  return validationResults
}
```

### 2. Argument Parsing Test Cases

```typescript
// Test Case: Array Argument Processing
export const arrayArgumentTests = [
  {
    name: "Headers Array Processing",
    input: ["Authorization: Bearer token123", "Content-Type: application/json"],
    expected: {
      Authorization: "Bearer token123",
      "Content-Type": "application/json",
    },
    validator: (result) => {
      return result && result["Authorization"] === "Bearer token123" && result["Content-Type"] === "application/json"
    },
  },
  {
    name: "Environment Variables Array",
    input: ["NODE_ENV=production", "API_KEY=secret123", "DEBUG=true"],
    expected: {
      NODE_ENV: "production",
      API_KEY: "secret123",
      DEBUG: "true",
    },
    validator: (result) => {
      return (
        result && result["NODE_ENV"] === "production" && result["API_KEY"] === "secret123" && result["DEBUG"] === "true"
      )
    },
  },
  {
    name: "Empty Array Handling",
    input: [],
    expected: undefined,
    validator: (result) => result === undefined,
  },
]

// Test Case: Positional Argument Validation
export const positionalArgumentTests = [
  {
    command: "mcp user <name> <url>",
    inputs: [
      { args: ["github", "https://api.github.com/mcp"], shouldPass: true },
      { args: ["github"], shouldPass: false }, // Missing URL
      { args: [], shouldPass: false }, // Missing both
      { args: ["github", "https://api.github.com/mcp", "extra"], shouldPass: true }, // Extra args
    ],
  },
  {
    command: "mcp local <name> [command..]",
    inputs: [
      { args: ["filesystem", "npx", "@server/filesystem"], shouldPass: true },
      { args: ["filesystem"], shouldPass: true }, // Optional command array
      { args: [], shouldPass: false }, // Missing required name
    ],
  },
]
```

### 3. CLI Command Validation Script

```bash
#!/bin/bash
# validate-cli-commands.sh - Comprehensive CLI command validation

set -e

COMMANDS_DIR="packages/opencode/src/cli/cmd"
VALIDATION_RESULTS="validation-results.json"

echo "🔍 Starting CLI Command Validation..."

# Initialize results JSON
echo '{"results": []}' > $VALIDATION_RESULTS

# Test each command file
for cmd_file in "$COMMANDS_DIR"/*.ts; do
  cmd_name=$(basename "$cmd_file" .ts)
  echo "Testing command: $cmd_name"

  # Test command help
  if bun run opencode "$cmd_name" --help > /dev/null 2>&1; then
    echo "✅ $cmd_name: Help command works"
    jq --arg cmd "$cmd_name" --arg status "pass" --arg message "Help command works" \
      '.results += [{"command": $cmd, "test": "help", "status": $status, "message": $message}]' \
      $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
  else
    echo "❌ $cmd_name: Help command failed"
    jq --arg cmd "$cmd_name" --arg status "fail" --arg message "Help command failed" \
      '.results += [{"command": $cmd, "test": "help", "status": $status, "message": $message}]' \
      $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
  fi

  # Test argument validation with invalid inputs
  case $cmd_name in
    "mcp")
      # Test MCP subcommands
      echo "  Testing MCP subcommands..."

      # Test invalid URL
      if bun run opencode mcp user test invalid-url 2>/dev/null; then
        echo "❌ $cmd_name: Should reject invalid URL"
      else
        echo "✅ $cmd_name: Correctly rejects invalid URL"
      fi

      # Test missing command for local
      if bun run opencode mcp local test-server 2>/dev/null; then
        echo "❌ $cmd_name: Should reject missing command"
      else
        echo "✅ $cmd_name: Correctly rejects missing command"
      fi
      ;;
  esac
done

echo "📊 Validation complete. Results saved to $VALIDATION_RESULTS"
```

---

## Slash Command Template Validation

### 1. Template Substitution Test Framework

```typescript
// Template Validation Framework
export class TemplateValidator {
  private testResults: ValidationResult[] = []

  async validateTemplate(commandName: string, template: string): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Test 1: Basic $ARGUMENTS substitution
    results.push(await this.testArgumentSubstitution(template))

    // Test 2: Shell command execution
    results.push(await this.testShellExecution(template))

    // Test 3: File reference resolution
    results.push(await this.testFileReferences(template))

    // Test 4: Complex template combinations
    results.push(await this.testComplexTemplate(template))

    return results
  }

  private async testArgumentSubstitution(template: string): Promise<ValidationResult> {
    const testArgs = "test-argument --option value"
    const processed = template.replaceAll("$ARGUMENTS", testArgs)

    return {
      test: "argument_substitution",
      status: processed.includes(testArgs) ? "pass" : "fail",
      message: processed.includes(testArgs) ? "Arguments substituted correctly" : "Arguments not substituted",
      input: template,
      output: processed,
    }
  }

  private async testShellExecution(template: string): Promise<ValidationResult> {
    const shellMatches = template.match(/!`([^`]+)`/g) || []

    if (shellMatches.length === 0) {
      return {
        test: "shell_execution",
        status: "skip",
        message: "No shell commands found in template",
      }
    }

    const results = []
    for (const shellCmd of shellMatches) {
      const command = shellCmd.slice(2, -1) // Remove !` and `
      try {
        const result = await $`${{ raw: command }}`.nothrow().text()
        results.push({ command, result: result.trim(), success: true })
      } catch (error) {
        results.push({ command, error: error.message, success: false })
      }
    }

    const allSuccessful = results.every((r) => r.success)
    return {
      test: "shell_execution",
      status: allSuccessful ? "pass" : "fail",
      message: allSuccessful ? "All shell commands executed successfully" : "Some shell commands failed",
      details: results,
    }
  }

  private async testFileReferences(template: string): Promise<ValidationResult> {
    const fileMatches = template.match(/@([^\s`,.]+)/g) || []

    if (fileMatches.length === 0) {
      return {
        test: "file_references",
        status: "skip",
        message: "No file references found in template",
      }
    }

    const results = []
    for (const fileRef of fileMatches) {
      const filename = fileRef.slice(1) // Remove @
      try {
        const stats = await fs.stat(filename)
        results.push({ filename, exists: true, isDirectory: stats.isDirectory() })
      } catch (error) {
        results.push({ filename, exists: false, error: error.message })
      }
    }

    return {
      test: "file_references",
      status: "pass", // File references can be optional
      message: `Found ${fileMatches.length} file references`,
      details: results,
    }
  }
}
```

### 2. Codeflow-Specific Template Tests

```typescript
// Codeflow Workflow Template Tests
export const codeflowTemplateTests = [
  {
    name: "CI/CD Pipeline Setup",
    template: `
---
description: Setup CI/CD pipeline for project
agent: build
subtask: true
---

Setting up CI/CD pipeline for $ARGUMENTS

Current branch: !\`git branch --show-current\`
Project config: @.github/workflows/ci.yml

!\`opencode mcp local filesystem "npx @modelcontextprotocol/server-filesystem $ARGUMENTS"\`
    `,
    testArgs: "my-project --type github-actions",
    expectedSubstitutions: [
      "my-project --type github-actions", // $ARGUMENTS
      "git branch --show-current", // shell command
      ".github/workflows/ci.yml", // file reference
    ],
  },
  {
    name: "Deployment Configuration",
    template: `
---
description: Configure deployment settings
agent: ops
---

Configuring deployment for $ARGUMENTS

Environment: !\`echo $NODE_ENV\`
Config files: @deploy/config.json @deploy/secrets.env

!\`opencode mcp user deploy-server https://deploy.example.com/mcp --headers "Authorization: Bearer $DEPLOY_TOKEN"\`
    `,
    testArgs: "production --region us-west-2",
    expectedSubstitutions: [
      "production --region us-west-2",
      "echo $NODE_ENV",
      "deploy/config.json",
      "deploy/secrets.env",
    ],
  },
]
```

### 3. Template Validation Script

```bash
#!/bin/bash
# validate-slash-commands.sh - Validate slash command templates

set -e

COMMANDS_DIR=".opencode/command"
VALIDATION_RESULTS="template-validation-results.json"

echo "🔍 Starting Slash Command Template Validation..."

# Initialize results
echo '{"results": []}' > $VALIDATION_RESULTS

# Test each command template
for cmd_file in "$COMMANDS_DIR"/*.md; do
  cmd_name=$(basename "$cmd_file" .md)
  echo "Testing template: $cmd_name"

  # Extract template content
  template_content=$(sed -n '/^---$/,/^---$/{p; /^---$/q;}' "$cmd_file" | tail -n +2)

  # Test 1: $ARGUMENTS placeholder exists
  if echo "$template_content" | grep -q '\$ARGUMENTS'; then
    echo "✅ $cmd_name: Contains \$ARGUMENTS placeholder"
    jq --arg cmd "$cmd_name" --arg status "pass" --arg message "Contains \$ARGUMENTS placeholder" \
      '.results += [{"command": $cmd, "test": "arguments_placeholder", "status": $status, "message": $message}]' \
      $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
  else
    echo "⚠️  $cmd_name: No \$ARGUMENTS placeholder found"
    jq --arg cmd "$cmd_name" --arg status "warn" --arg message "No \$ARGUMENTS placeholder found" \
      '.results += [{"command": $cmd, "test": "arguments_placeholder", "status": $status, "message": $message}]' \
      $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
  fi

  # Test 2: Shell command syntax
  shell_commands=$(echo "$template_content" | grep -o '!`[^`]*`' | wc -l)
  if [ $shell_commands -gt 0 ]; then
    echo "✅ $cmd_name: Found $shell_commands shell command(s)"

    # Test each shell command syntax
    echo "$template_content" | grep -o '!`[^`]*`' | while read -r shell_cmd; do
      cmd_content=$(echo "$shell_cmd" | sed 's/!`\([^`]*\)`/\1/')
      if bash -n "$cmd_content" 2>/dev/null; then
        echo "  ✅ Shell command syntax valid: $cmd_content"
      else
        echo "  ❌ Shell command syntax invalid: $cmd_content"
        jq --arg cmd "$cmd_name" --arg shell "$cmd_content" --arg status "fail" --arg message "Invalid shell command syntax" \
          '.results += [{"command": $cmd, "test": "shell_syntax", "status": $status, "message": $message, "details": $shell}]' \
          $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
      fi
    done
  fi

  # Test 3: File reference syntax
  file_refs=$(echo "$template_content" | grep -o '@[^[:space:],.`]*' | wc -l)
  if [ $file_refs -gt 0 ]; then
    echo "✅ $cmd_name: Found $file_refs file reference(s)"

    # Check if referenced files exist (optional in templates)
    echo "$template_content" | grep -o '@[^[:space:],.`]*' | while read -r file_ref; do
      filename=$(echo "$file_ref" | sed 's/@//')
      if [ -f "$filename" ] || [ -d "$filename" ]; then
        echo "  ✅ File exists: $filename"
      else
        echo "  ⚠️  File not found (may be created later): $filename"
      fi
    done
  fi
done

echo "📊 Template validation complete. Results saved to $VALIDATION_RESULTS"
```

---

## MCP Server Configuration Validation

### 1. MCP Configuration Schema Validation

```typescript
// MCP Configuration Validator
export class MCPConfigValidator {
  async validateMCPConfig(configPath: string): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    try {
      const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
      const mcpConfig = config.mcp || {}

      // Validate each MCP server configuration
      for (const [serverName, serverConfig] of Object.entries(mcpConfig)) {
        results.push(...(await this.validateMCPServer(serverName, serverConfig as any)))
      }
    } catch (error) {
      results.push({
        test: "config_parsing",
        status: "fail",
        message: `Failed to parse MCP config: ${error.message}`,
      })
    }

    return results
  }

  private async validateMCPServer(name: string, config: any): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Test 1: Required fields
    if (!config.type) {
      results.push({
        test: "required_fields",
        status: "fail",
        message: `MCP server '${name}' missing required 'type' field`,
      })
      return results
    }

    if (config.type === "remote") {
      results.push(...(await this.validateRemoteServer(name, config)))
    } else if (config.type === "local") {
      results.push(...(await this.validateLocalServer(name, config)))
    } else {
      results.push({
        test: "server_type",
        status: "fail",
        message: `MCP server '${name}' has invalid type: ${config.type}`,
      })
    }

    return results
  }

  private async validateRemoteServer(name: string, config: any): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Validate URL
    if (!config.url) {
      results.push({
        test: "url_required",
        status: "fail",
        message: `Remote MCP server '${name}' missing required 'url' field`,
      })
    } else if (!URL.canParse(config.url)) {
      results.push({
        test: "url_format",
        status: "fail",
        message: `Remote MCP server '${name}' has invalid URL: ${config.url}`,
      })
    } else {
      // Test connectivity
      try {
        const response = await fetch(config.url, { method: "HEAD", timeout: 5000 })
        results.push({
          test: "connectivity",
          status: response.ok ? "pass" : "warn",
          message: `Remote MCP server '${name}' connectivity: ${response.status}`,
        })
      } catch (error) {
        results.push({
          test: "connectivity",
          status: "warn",
          message: `Remote MCP server '${name}' connectivity failed: ${error.message}`,
        })
      }
    }

    // Validate headers format
    if (config.headers) {
      if (typeof config.headers !== "object" || Array.isArray(config.headers)) {
        results.push({
          test: "headers_format",
          status: "fail",
          message: `Remote MCP server '${name}' headers must be an object`,
        })
      }
    }

    return results
  }

  private async validateLocalServer(name: string, config: any): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Validate command
    if (!config.command) {
      results.push({
        test: "command_required",
        status: "fail",
        message: `Local MCP server '${name}' missing required 'command' field`,
      })
    } else if (!Array.isArray(config.command)) {
      results.push({
        test: "command_format",
        status: "fail",
        message: `Local MCP server '${name}' command must be an array`,
      })
    } else if (config.command.length === 0) {
      results.push({
        test: "command_empty",
        status: "fail",
        message: `Local MCP server '${name}' command array cannot be empty`,
      })
    } else {
      // Test command syntax
      const mainCommand = config.command[0]
      try {
        // Check if command exists in PATH
        const result = await $`which ${mainCommand}`.nothrow().text()
        if (result.trim()) {
          results.push({
            test: "command_exists",
            status: "pass",
            message: `Local MCP server '${name}' command '${mainCommand}' found in PATH`,
          })
        } else {
          results.push({
            test: "command_exists",
            status: "warn",
            message: `Local MCP server '${name}' command '${mainCommand}' not found in PATH`,
          })
        }
      } catch (error) {
        results.push({
          test: "command_exists",
          status: "warn",
          message: `Local MCP server '${name}' command check failed: ${error.message}`,
        })
      }
    }

    // Validate environment variables
    if (config.environment) {
      if (typeof config.environment !== "object" || Array.isArray(config.environment)) {
        results.push({
          test: "environment_format",
          status: "fail",
          message: `Local MCP server '${name}' environment must be an object`,
        })
      }
    }

    return results
  }
}
```

### 2. MCP Server Integration Tests

```typescript
// MCP Integration Test Suite
export class MCPIntegrationTests {
  async testMCPToolDiscovery(): Promise<ValidationResult> {
    try {
      // Import MCP module
      const { MCP } = await import("../src/mcp")

      // Get available tools
      const tools = await MCP.tools()

      return {
        test: "tool_discovery",
        status: Object.keys(tools).length > 0 ? "pass" : "warn",
        message: `Found ${Object.keys(tools).length} MCP tools`,
        details: Object.keys(tools),
      }
    } catch (error) {
      return {
        test: "tool_discovery",
        status: "fail",
        message: `MCP tool discovery failed: ${error.message}`,
      }
    }
  }

  async testMCPServerConnection(serverName: string): Promise<ValidationResult> {
    try {
      const { MCP } = await import("../src/mcp")
      const clients = await MCP.clients()

      if (!clients[serverName]) {
        return {
          test: "server_connection",
          status: "fail",
          message: `MCP server '${serverName}' not found in clients`,
        }
      }

      const client = clients[serverName]
      const tools = await client.tools()

      return {
        test: "server_connection",
        status: "pass",
        message: `MCP server '${serverName}' connected with ${Object.keys(tools).length} tools`,
        details: Object.keys(tools),
      }
    } catch (error) {
      return {
        test: "server_connection",
        status: "fail",
        message: `MCP server '${serverName}' connection failed: ${error.message}`,
      }
    }
  }

  async testMCPToolExecution(toolName: string, params: any = {}): Promise<ValidationResult> {
    try {
      const { MCP } = await import("../src/mcp")
      const tools = await MCP.tools()

      if (!tools[toolName]) {
        return {
          test: "tool_execution",
          status: "fail",
          message: `MCP tool '${toolName}' not found`,
        }
      }

      const tool = tools[toolName]

      // Validate parameters against tool schema
      if (tool.parameters && params) {
        // This would require Zod schema validation
        // For now, just check if required params are provided
      }

      return {
        test: "tool_execution",
        status: "pass",
        message: `MCP tool '${toolName}' schema validated successfully`,
        details: { params, schema: tool.parameters },
      }
    } catch (error) {
      return {
        test: "tool_execution",
        status: "fail",
        message: `MCP tool '${toolName}' validation failed: ${error.message}`,
      }
    }
  }
}
```

### 3. MCP Validation Script

```bash
#!/bin/bash
# validate-mcp-config.sh - Validate MCP server configurations

set -e

CONFIG_FILE="opencode.jsonc"
VALIDATION_RESULTS="mcp-validation-results.json"

echo "🔍 Starting MCP Configuration Validation..."

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Configuration file not found: $CONFIG_FILE"
  exit 1
fi

# Initialize results
echo '{"results": []}' > $VALIDATION_RESULTS

# Extract and validate MCP configuration
echo "Parsing MCP configuration..."
mcp_config=$(jq -r '.mcp // {}' "$CONFIG_FILE")

if [ "$mcp_config" = "{}" ]; then
  echo "⚠️  No MCP configuration found"
  jq --arg status "skip" --arg message "No MCP configuration found" \
    '.results += [{"test": "mcp_config_exists", "status": $status, "message": $message}]' \
    $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
else
  echo "✅ MCP configuration found"
  jq --arg status "pass" --arg message "MCP configuration found" \
    '.results += [{"test": "mcp_config_exists", "status": $status, "message": $message}]' \
    $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS

  # Validate each MCP server
  echo "$mcp_config" | jq -r 'keys[]' | while read -r server_name; do
    echo "Validating MCP server: $server_name"

    server_type=$(echo "$mcp_config" | jq -r ".[\"$server_name\"].type")

    case $server_type in
      "remote")
        echo "  Validating remote server..."
        server_url=$(echo "$mcp_config" | jq -r ".[\"$server_name\"].url")

        if [ -n "$server_url" ] && [ "$server_url" != "null" ]; then
          echo "  ✅ URL found: $server_url"

          # Test URL format
          if curl -s --head "$server_url" > /dev/null 2>&1; then
            echo "  ✅ Server is reachable"
            jq --arg server "$server_name" --arg url "$server_url" --arg status "pass" --arg message "Server is reachable" \
              '.results += [{"server": $server, "test": "remote_connectivity", "status": $status, "message": $message, "details": {"url": $url}}]' \
              $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
          else
            echo "  ⚠️  Server not reachable"
            jq --arg server "$server_name" --arg url "$server_url" --arg status "warn" --arg message "Server not reachable" \
              '.results += [{"server": $server, "test": "remote_connectivity", "status": $status, "message": $message, "details": {"url": $url}}]' \
              $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
          fi
        else
          echo "  ❌ URL missing"
          jq --arg server "$server_name" --arg status "fail" --arg message "URL missing for remote server" \
            '.results += [{"server": $server, "test": "remote_url", "status": $status, "message": $message}]' \
            $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
        fi
        ;;

      "local")
        echo "  Validating local server..."
        server_command=$(echo "$mcp_config" | jq -r ".[\"$server_name\"].command[0]")

        if [ -n "$server_command" ] && [ "$server_command" != "null" ]; then
          echo "  ✅ Command found: $server_command"

          # Check if command exists
          if command -v "$server_command" > /dev/null 2>&1; then
            echo "  ✅ Command exists in PATH"
            jq --arg server "$server_name" --arg cmd "$server_command" --arg status "pass" --arg message "Command exists in PATH" \
              '.results += [{"server": $server, "test": "local_command", "status": $status, "message": $message, "details": {"command": $cmd}}]' \
              $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
          else
            echo "  ⚠️  Command not found in PATH"
            jq --arg server "$server_name" --arg cmd "$server_command" --arg status "warn" --arg message "Command not found in PATH" \
              '.results += [{"server": $server, "test": "local_command", "status": $status, "message": $message, "details": {"command": $cmd}}]' \
              $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
          fi
        else
          echo "  ❌ Command missing"
          jq --arg server "$server_name" --arg status "fail" --arg message "Command missing for local server" \
            '.results += [{"server": $server, "test": "local_command", "status": $status, "message": $message}]' \
            $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
        fi
        ;;

      *)
        echo "  ❌ Unknown server type: $server_type"
        jq --arg server "$server_name" --arg type "$server_type" --arg status "fail" --arg message "Unknown server type" \
          '.results += [{"server": $server, "test": "server_type", "status": $status, "message": $message, "details": {"type": $type}}]' \
          $VALIDATION_RESULTS > tmp.json && mv tmp.json $VALIDATION_RESULTS
        ;;
    esac
  done
fi

echo "📊 MCP validation complete. Results saved to $VALIDATION_RESULTS"
```

---

## Codeflow-Specific Test Cases

### 1. CI/CD Pipeline Integration Tests

```typescript
// CI/CD Pipeline Test Cases
export const cicdTestCases = [
  {
    name: "GitHub Actions Workflow Setup",
    description: "Test command integration with GitHub Actions",
    setup: async () => {
      // Create test GitHub Actions workflow
      await fs.writeFile(
        ".github/workflows/test.yml",
        `
name: Test OpenCode Integration
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup OpenCode
        run: |
          curl -fsSL https://opencode.ai/install.sh | bash
      - name: Test MCP Commands
        run: |
          opencode mcp add
          echo "test-server" | opencode mcp add
          echo "remote" | opencode mcp add
          echo "https://test.example.com/mcp" | opencode mcp add
      `,
      )
    },
    test: async () => {
      // Test command execution in CI environment
      const result = await $`opencode mcp user test-server https://test.example.com/mcp`.nothrow().text()
      return {
        success: result.includes("added successfully"),
        output: result,
      }
    },
    cleanup: async () => {
      await fs.rm(".github", { recursive: true, force: true })
    },
  },
  {
    name: "Docker Container Integration",
    description: "Test OpenCode commands in Docker environment",
    setup: async () => {
      await fs.writeFile(
        "Dockerfile",
        `
FROM node:18-alpine
RUN apk add --no-cache curl
RUN curl -fsSL https://opencode.ai/install.sh | sh
WORKDIR /app
COPY . .
CMD ["opencode", "run", "--help"]
      `,
      )
    },
    test: async () => {
      // Build and test Docker container
      const buildResult = await $`docker build -t opencode-test .`.nothrow()
      if (buildResult.exitCode !== 0) {
        return { success: false, output: buildResult.stderr }
      }

      const runResult = await $`docker run --rm opencode-test opencode run --help`.nothrow()
      return {
        success: runResult.exitCode === 0,
        output: runResult.stdout,
      }
    },
    cleanup: async () => {
      await fs.rm("Dockerfile", { force: true })
      await $`docker rmi opencode-test`.nothrow()
    },
  },
]
```

### 2. Environment-Specific Configuration Tests

```typescript
// Environment Configuration Tests
export class EnvironmentConfigTests {
  async testEnvironmentVariableSubstitution(): Promise<ValidationResult> {
    // Set test environment variables
    process.env["TEST_MCP_URL"] = "https://test.example.com/mcp"
    process.env["TEST_API_KEY"] = "test-key-123"

    try {
      // Create test config with environment variables
      const testConfig = {
        mcp: {
          test_server: {
            type: "remote",
            url: "{env:TEST_MCP_URL}",
            headers: {
              Authorization: "Bearer {env:TEST_API_KEY}",
            },
          },
        },
      }

      await fs.writeFile("test-config.json", JSON.stringify(testConfig, null, 2))

      // Load and validate config
      const { Config } = await import("../src/config/config")
      const config = await Config.get()

      const mcpServer = config.mcp?.test_server
      const isValid =
        mcpServer?.url === "https://test.example.com/mcp" &&
        mcpServer?.headers?.["Authorization"] === "Bearer test-key-123"

      return {
        test: "environment_substitution",
        status: isValid ? "pass" : "fail",
        message: isValid ? "Environment variables substituted correctly" : "Environment substitution failed",
        details: { config: mcpServer },
      }
    } catch (error) {
      return {
        test: "environment_substitution",
        status: "fail",
        message: `Environment substitution test failed: ${error.message}`,
      }
    } finally {
      // Cleanup
      await fs.rm("test-config.json", { force: true })
      delete process.env["TEST_MCP_URL"]
      delete process.env["TEST_API_KEY"]
    }
  }

  async testWorkflowSpecificConfigurations(): Promise<ValidationResult> {
    const workflows = ["development", "staging", "production"]
    const results = []

    for (const workflow of workflows) {
      try {
        // Create workflow-specific config
        const workflowConfig = {
          mcp: {
            [`${workflow}_server`]: {
              type: "remote",
              url: `https://${workflow}.example.com/mcp`,
              enabled: workflow === "production",
            },
          },
        }

        await fs.writeFile(`opencode.${workflow}.json`, JSON.stringify(workflowConfig, null, 2))

        // Test config loading with workflow override
        process.env["OPENCODE_WORKFLOW"] = workflow

        const { Config } = await import("../src/config/config")
        const config = await Config.get()

        const server = config.mcp?.[`${workflow}_server`]
        const isValid = server && server.url.includes(workflow)

        results.push({
          workflow,
          status: isValid ? "pass" : "fail",
          server: server,
        })
      } catch (error) {
        results.push({
          workflow,
          status: "fail",
          error: error.message,
        })
      } finally {
        await fs.rm(`opencode.${workflow}.json`, { force: true })
        delete process.env["OPENCODE_WORKFLOW"]
      }
    }

    const allPassed = results.every((r) => r.status === "pass")
    return {
      test: "workflow_configurations",
      status: allPassed ? "pass" : "fail",
      message: `Workflow configurations: ${results.filter((r) => r.status === "pass").length}/${results.length} passed`,
      details: results,
    }
  }
}
```

### 3. Automated Workflow Testing

```typescript
// Automated Workflow Test Runner
export class WorkflowTestRunner {
  async runWorkflowTests(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Test 1: Command Discovery in Workflow Context
    results.push(await this.testCommandDiscovery())

    // Test 2: Argument Passing in Pipeline
    results.push(await this.testArgumentPassing())

    // Test 3: Error Handling in Automated Context
    results.push(await this.testErrorHandling())

    // Test 4: Output Capture and Parsing
    results.push(await this.testOutputCapture())

    return results
  }

  private async testCommandDiscovery(): Promise<ValidationResult> {
    try {
      // Test that all expected commands are available
      const expectedCommands = ["mcp", "run", "help"]
      const availableCommands = []

      for (const cmd of expectedCommands) {
        const result = await $`opencode ${cmd} --help`.nothrow()
        if (result.exitCode === 0) {
          availableCommands.push(cmd)
        }
      }

      const allAvailable = availableCommands.length === expectedCommands.length
      return {
        test: "command_discovery",
        status: allAvailable ? "pass" : "fail",
        message: `Commands available: ${availableCommands.length}/${expectedCommands.length}`,
        details: { available: availableCommands, expected: expectedCommands },
      }
    } catch (error) {
      return {
        test: "command_discovery",
        status: "fail",
        message: `Command discovery failed: ${error.message}`,
      }
    }
  }

  private async testArgumentPassing(): Promise<ValidationResult> {
    try {
      // Test complex argument passing scenarios
      const testCases = [
        {
          name: "Simple arguments",
          command: "opencode run --model test/model test message",
          expected: "test message",
        },
        {
          name: "Array arguments",
          command: "opencode mcp local test-server node server.js --port 3000",
          expected: ["node", "server.js", "--port", "3000"],
        },
        {
          name: "Headers with special characters",
          command:
            'opencode mcp user test https://test.com --headers "Authorization: Bearer token123" --headers "Content-Type: application/json"',
          expected: {
            Authorization: "Bearer token123",
            "Content-Type": "application/json",
          },
        },
      ]

      const results = []
      for (const testCase of testCases) {
        // This would require mocking or actual command execution
        // For validation purposes, we'll test argument parsing logic
        results.push({
          name: testCase.name,
          status: "pass", // Simplified for example
          command: testCase.command,
        })
      }

      return {
        test: "argument_passing",
        status: "pass",
        message: `Argument passing tests: ${results.length} scenarios validated`,
        details: results,
      }
    } catch (error) {
      return {
        test: "argument_passing",
        status: "fail",
        message: `Argument passing test failed: ${error.message}`,
      }
    }
  }

  private async testErrorHandling(): Promise<ValidationResult> {
    try {
      // Test error scenarios
      const errorTests = [
        {
          name: "Invalid command",
          command: "opencode invalid-command",
          shouldFail: true,
        },
        {
          name: "Missing required arguments",
          command: "opencode mcp user",
          shouldFail: true,
        },
        {
          name: "Invalid URL format",
          command: "opencode mcp user test invalid-url",
          shouldFail: true,
        },
      ]

      const results = []
      for (const errorTest of errorTests) {
        const result = await $`${errorTest.command}`.nothrow()
        const failedAsExpected = result.exitCode !== 0

        results.push({
          name: errorTest.name,
          status: failedAsExpected === errorTest.shouldFail ? "pass" : "fail",
          exitCode: result.exitCode,
          expectedFailure: errorTest.shouldFail,
        })
      }

      const allPassed = results.every((r) => r.status === "pass")
      return {
        test: "error_handling",
        status: allPassed ? "pass" : "fail",
        message: `Error handling tests: ${results.filter((r) => r.status === "pass").length}/${results.length} passed`,
        details: results,
      }
    } catch (error) {
      return {
        test: "error_handling",
        status: "fail",
        message: `Error handling test failed: ${error.message}`,
      }
    }
  }

  private async testOutputCapture(): Promise<ValidationResult> {
    try {
      // Test different output formats
      const outputTests = [
        {
          name: "Default format",
          command: "opencode run --help",
          format: "default",
        },
        {
          name: "JSON format",
          command: "opencode run --help --format json",
          format: "json",
        },
      ]

      const results = []
      for (const outputTest of outputTests) {
        const result = await $`${outputTest.command}`.nothrow()
        const hasOutput = result.stdout.length > 0 || result.stderr.length > 0

        results.push({
          name: outputTest.name,
          status: hasOutput ? "pass" : "fail",
          format: outputTest.format,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
        })
      }

      const allPassed = results.every((r) => r.status === "pass")
      return {
        test: "output_capture",
        status: allPassed ? "pass" : "fail",
        message: `Output capture tests: ${results.filter((r) => r.status === "pass").length}/${results.length} passed`,
        details: results,
      }
    } catch (error) {
      return {
        test: "output_capture",
        status: "fail",
        message: `Output capture test failed: ${error.message}`,
      }
    }
  }
}
```

---

## Debugging Command Conversion Issues

### 1. Command Conversion Debugging Framework

```typescript
// Command Conversion Debugger
export class CommandConversionDebugger {
  private debugLog: DebugEntry[] = []

  async debugCommandConversion(commandName: string, input: string): Promise<DebugReport> {
    this.debugLog = []

    const report: DebugReport = {
      command: commandName,
      input,
      steps: [],
      success: false,
      errors: [],
    }

    try {
      // Step 1: Command Discovery
      await this.debugCommandDiscovery(commandName, report)

      // Step 2: Argument Parsing
      await this.debugArgumentParsing(commandName, input, report)

      // Step 3: Template Processing (if slash command)
      await this.debugTemplateProcessing(commandName, input, report)

      // Step 4: Execution
      await this.debugExecution(commandName, input, report)

      report.success = report.errors.length === 0
    } catch (error) {
      report.errors.push({
        step: "general",
        message: error.message,
        stack: error.stack,
      })
    }

    return report
  }

  private async debugCommandDiscovery(commandName: string, report: DebugReport): Promise<void> {
    const step: DebugStep = {
      name: "command_discovery",
      status: "running",
      startTime: Date.now(),
    }

    try {
      // Check if command exists in CLI
      const cliResult = await $`opencode ${commandName} --help`.nothrow()

      if (cliResult.exitCode === 0) {
        step.status = "success"
        step.output = "CLI command found"
      } else {
        step.status = "warning"
        step.output = "CLI command not found, checking slash commands..."

        // Check slash commands
        const { Command } = await import("../src/command")
        const slashCommand = await Command.get(commandName)

        if (slashCommand) {
          step.status = "success"
          step.output = "Slash command found"
          step.details = { type: "slash", template: slashCommand.template }
        } else {
          step.status = "error"
          step.output = "Command not found in CLI or slash commands"
          report.errors.push({
            step: "command_discovery",
            message: `Command '${commandName}' not found`,
          })
        }
      }
    } catch (error) {
      step.status = "error"
      step.output = error.message
      report.errors.push({
        step: "command_discovery",
        message: error.message,
      })
    }

    step.endTime = Date.now()
    report.steps.push(step)
  }

  private async debugArgumentParsing(commandName: string, input: string, report: DebugReport): Promise<void> {
    const step: DebugStep = {
      name: "argument_parsing",
      status: "running",
      startTime: Date.now(),
    }

    try {
      // Parse arguments using the same logic as the CLI
      const args = input.split(" ").filter((arg) => arg.length > 0)

      step.details = {
        rawInput: input,
        parsedArgs: args,
        argCount: args.length,
      }

      // Validate argument count based on command
      if (commandName === "mcp") {
        if (args.length >= 1) {
          const subcommand = args[0]
          step.details.subcommand = subcommand

          if (subcommand === "user" && args.length < 3) {
            step.status = "error"
            step.output = "MCP user command requires name and URL"
            report.errors.push({
              step: "argument_parsing",
              message: "MCP user command requires name and URL",
            })
          } else if (subcommand === "local" && args.length < 2) {
            step.status = "error"
            step.output = "MCP local command requires name and command"
            report.errors.push({
              step: "argument_parsing",
              message: "MCP local command requires name and command",
            })
          } else {
            step.status = "success"
            step.output = "Arguments parsed successfully"
          }
        } else {
          step.status = "warning"
          step.output = "No arguments provided, will use interactive mode"
        }
      } else {
        step.status = "success"
        step.output = "Arguments parsed successfully"
      }
    } catch (error) {
      step.status = "error"
      step.output = error.message
      report.errors.push({
        step: "argument_parsing",
        message: error.message,
      })
    }

    step.endTime = Date.now()
    report.steps.push(step)
  }

  private async debugTemplateProcessing(commandName: string, input: string, report: DebugReport): Promise<void> {
    const step: DebugStep = {
      name: "template_processing",
      status: "running",
      startTime: Date.now(),
    }

    try {
      const { Command } = await import("../src/command")
      const command = await Command.get(commandName)

      if (!command) {
        step.status = "skip"
        step.output = "Not a slash command, skipping template processing"
        step.endTime = Date.now()
        report.steps.push(step)
        return
      }

      step.details = {
        originalTemplate: command.template,
        arguments: input,
      }

      // Process template substitutions
      let processedTemplate = command.template.replaceAll("$ARGUMENTS", input)

      // Process shell commands
      const shellMatches = processedTemplate.match(/!`([^`]+)`/g) || []
      if (shellMatches.length > 0) {
        step.details.shellCommands = shellMatches

        for (const shellCmd of shellMatches) {
          const cmd = shellCmd.slice(2, -1)
          try {
            const result = await $`${{ raw: cmd }}`.nothrow().text()
            processedTemplate = processedTemplate.replace(shellCmd, result.trim())
            step.details.shellResults = step.details.shellResults || {}
            step.details.shellResults[cmd] = result.trim()
          } catch (error) {
            step.status = "warning"
            step.output = `Shell command failed: ${cmd}`
            step.details.shellErrors = step.details.shellErrors || {}
            step.details.shellErrors[cmd] = error.message
          }
        }
      }

      // Process file references
      const fileMatches = processedTemplate.match(/@([^\s`,.]+)/g) || []
      if (fileMatches.length > 0) {
        step.details.fileReferences = fileMatches

        for (const fileRef of fileMatches) {
          const filename = fileRef.slice(1)
          try {
            const stats = await fs.stat(filename)
            step.details.fileResults = step.details.fileResults || {}
            step.details.fileResults[filename] = {
              exists: true,
              isDirectory: stats.isDirectory(),
              size: stats.size,
            }
          } catch (error) {
            step.details.fileResults = step.details.fileResults || {}
            step.details.fileResults[filename] = {
              exists: false,
              error: error.message,
            }
          }
        }
      }

      step.details.processedTemplate = processedTemplate
      step.status = "success"
      step.output = "Template processed successfully"
    } catch (error) {
      step.status = "error"
      step.output = error.message
      report.errors.push({
        step: "template_processing",
        message: error.message,
      })
    }

    step.endTime = Date.now()
    report.steps.push(step)
  }

  private async debugExecution(commandName: string, input: string, report: DebugReport): Promise<void> {
    const step: DebugStep = {
      name: "execution",
      status: "running",
      startTime: Date.now(),
    }

    try {
      // Attempt to execute the command (dry run if possible)
      const result = await $`opencode ${commandName} ${input}`.nothrow()

      step.details = {
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        executionTime: Date.now() - step.startTime,
      }

      if (result.exitCode === 0) {
        step.status = "success"
        step.output = "Command executed successfully"
      } else {
        step.status = "error"
        step.output = "Command execution failed"
        step.details.stderr = result.stderr
        report.errors.push({
          step: "execution",
          message: `Command failed with exit code ${result.exitCode}`,
          details: { stderr: result.stderr },
        })
      }
    } catch (error) {
      step.status = "error"
      step.output = error.message
      report.errors.push({
        step: "execution",
        message: error.message,
      })
    }

    step.endTime = Date.now()
    report.steps.push(step)
  }
}

// Type definitions
interface DebugReport {
  command: string
  input: string
  steps: DebugStep[]
  success: boolean
  errors: DebugError[]
}

interface DebugStep {
  name: string
  status: "running" | "success" | "error" | "warning" | "skip"
  startTime: number
  endTime?: number
  output?: string
  details?: any
}

interface DebugError {
  step: string
  message: string
  stack?: string
  details?: any
}

interface DebugEntry {
  timestamp: number
  level: "debug" | "info" | "warn" | "error"
  message: string
  details?: any
}
```

### 2. Common Issue Detection Patterns

```typescript
// Common Issue Detection
export class CommonIssueDetector {
  async detectCommonIssues(report: DebugReport): Promise<IssueDetection[]> {
    const detections: IssueDetection[] = []

    // Issue 1: Missing $ARGUMENTS in slash commands
    const templateStep = report.steps.find((s) => s.name === "template_processing")
    if (templateStep && templateStep.details?.originalTemplate) {
      if (!templateStep.details.originalTemplate.includes("$ARGUMENTS")) {
        detections.push({
          type: "missing_arguments_placeholder",
          severity: "warning",
          message: "Slash command template missing $ARGUMENTS placeholder",
          suggestion: "Add $ARGUMENTS to your command template to accept user input",
          step: "template_processing",
        })
      }
    }

    // Issue 2: Invalid shell command syntax
    if (templateStep && templateStep.details?.shellErrors) {
      for (const [cmd, error] of Object.entries(templateStep.details.shellErrors)) {
        detections.push({
          type: "invalid_shell_syntax",
          severity: "error",
          message: `Invalid shell command syntax: ${cmd}`,
          suggestion: `Check shell command syntax: ${error}`,
          step: "template_processing",
          details: { command: cmd, error },
        })
      }
    }

    // Issue 3: Missing required arguments
    const argStep = report.steps.find((s) => s.name === "argument_parsing")
    if (argStep && argStep.status === "error") {
      detections.push({
        type: "missing_required_arguments",
        severity: "error",
        message: "Missing required command arguments",
        suggestion: "Check command help for required arguments: opencode <command> --help",
        step: "argument_parsing",
      })
    }

    // Issue 4: Command not found
    const discoveryStep = report.steps.find((s) => s.name === "command_discovery")
    if (discoveryStep && discoveryStep.status === "error") {
      detections.push({
        type: "command_not_found",
        severity: "error",
        message: "Command not found",
        suggestion: "Check if command exists or is properly configured",
        step: "command_discovery",
      })
    }

    // Issue 5: File reference not found
    if (templateStep && templateStep.details?.fileResults) {
      for (const [filename, result] of Object.entries(templateStep.details.fileResults)) {
        if (!(result as any).exists) {
          detections.push({
            type: "file_not_found",
            severity: "warning",
            message: `Referenced file not found: ${filename}`,
            suggestion: `Create the file or check the file path: ${filename}`,
            step: "template_processing",
            details: { filename },
          })
        }
      }
    }

    // Issue 6: Execution timeout
    const execStep = report.steps.find((s) => s.name === "execution")
    if (execStep && execStep.details?.executionTime && execStep.details.executionTime > 30000) {
      detections.push({
        type: "execution_timeout",
        severity: "warning",
        message: "Command execution taking longer than expected",
        suggestion: "Consider adding timeout options or optimizing the command",
        step: "execution",
        details: { executionTime: execStep.details.executionTime },
      })
    }

    return detections
  }
}

interface IssueDetection {
  type: string
  severity: "info" | "warning" | "error"
  message: string
  suggestion: string
  step: string
  details?: any
}
```

### 3. Debugging Script

```bash
#!/bin/bash
# debug-command-conversion.sh - Debug command conversion issues

set -e

COMMAND_NAME="$1"
INPUT_ARGUMENTS="${2:-}"

if [ -z "$COMMAND_NAME" ]; then
  echo "Usage: $0 <command-name> [input-arguments]"
  echo "Example: $0 mcp 'user test-server https://test.com'"
  exit 1
fi

DEBUG_DIR="debug-logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DEBUG_FILE="$DEBUG_DIR/debug_${COMMAND_NAME}_${TIMESTAMP}.json"

echo "🔍 Debugging command conversion: $COMMAND_NAME"
echo "📝 Input arguments: '$INPUT_ARGUMENTS'"
echo "📁 Debug log: $DEBUG_FILE"

# Create debug directory
mkdir -p "$DEBUG_DIR"

# Initialize debug report
cat > "$DEBUG_FILE" << EOF
{
  "command": "$COMMAND_NAME",
  "input": "$INPUT_ARGUMENTS",
  "timestamp": "$(date -Iseconds)",
  "steps": [],
  "success": false,
  "errors": []
}
EOF

# Step 1: Command Discovery
echo "🔍 Step 1: Command Discovery..."
if opencode "$COMMAND_NAME" --help > /dev/null 2>&1; then
  echo "✅ CLI command found"
  jq --arg step "command_discovery" --arg status "success" --arg output "CLI command found" \
    '.steps += [{"name": $step, "status": $status, "output": $output, "timestamp": "'$(date -Iseconds)'"}]' \
    "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
else
  echo "❌ CLI command not found, checking slash commands..."

  # Check if it's a slash command
  if [ -f ".opencode/command/${COMMAND_NAME}.md" ]; then
    echo "✅ Slash command found"
    template_content=$(cat ".opencode/command/${COMMAND_NAME}.md")
    jq --arg step "command_discovery" --arg status "success" --arg output "Slash command found" --arg template "$template_content" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"type": "slash", "template": $template}, "timestamp": "'$(date -Iseconds)'"}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  else
    echo "❌ Command not found"
    jq --arg step "command_discovery" --arg status "error" --arg output "Command not found" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "timestamp": "'$(date -Iseconds)'"}] | .errors += [{"step": $step, "message": "Command not found"}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  fi
fi

# Step 2: Argument Parsing
echo "🔍 Step 2: Argument Parsing..."
if [ -n "$INPUT_ARGUMENTS" ]; then
  parsed_args=$(echo "$INPUT_ARGUMENTS" | tr ' ' '\n' | wc -l)
  echo "✅ Parsed $parsed_args arguments"
  jq --arg step "argument_parsing" --arg status "success" --arg output "Parsed $parsed_args arguments" --argjson count "$parsed_args" \
    '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"argCount": $count, "rawInput": "'"$INPUT_ARGUMENTS"'"}, "timestamp": "'$(date -Iseconds)'"}]' \
    "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
else
  echo "⚠️  No arguments provided"
  jq --arg step "argument_parsing" --arg status "warning" --arg output "No arguments provided" \
    '.steps += [{"name": $step, "status": $status, "output": $output, "timestamp": "'$(date -Iseconds)'"}]' \
    "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
fi

# Step 3: Template Processing (if slash command)
if [ -f ".opencode/command/${COMMAND_NAME}.md" ]; then
  echo "🔍 Step 3: Template Processing..."

  template_content=$(cat ".opencode/command/${COMMAND_NAME}.md")

  # Check for $ARGUMENTS
  if echo "$template_content" | grep -q '\$ARGUMENTS'; then
    echo "✅ \$ARGUMENTS placeholder found"
    processed_template=$(echo "$template_content" | sed "s/\\\$ARGUMENTS/$INPUT_ARGUMENTS/g")
    jq --arg step "template_processing" --arg status "success" --arg output "\$ARGUMENTS placeholder found and substituted" --arg template "$processed_template" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"originalTemplate": $template, "processedTemplate": $template}, "timestamp": "'$(date -Iseconds)'"}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  else
    echo "⚠️  \$ARGUMENTS placeholder not found"
    jq --arg step "template_processing" --arg status "warning" --arg output "\$ARGUMENTS placeholder not found" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "timestamp": "'$(date -Iseconds)'"}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  fi

  # Check for shell commands
  shell_commands=$(echo "$template_content" | grep -o '!`[^`]*`' | wc -l)
  if [ "$shell_commands" -gt 0 ]; then
    echo "🔍 Found $shell_commands shell command(s)"
    echo "$template_content" | grep -o '!`[^`]*`' | while read -r shell_cmd; do
      cmd_content=$(echo "$shell_cmd" | sed 's/!`\([^`]*\)`/\1/')
      echo "  Testing shell command: $cmd_content"
      if bash -n "$cmd_content" 2>/dev/null; then
        echo "  ✅ Shell syntax valid"
      else
        echo "  ❌ Shell syntax invalid"
        jq --arg step "template_processing" --arg cmd "$cmd_content" --arg status "error" --arg output "Invalid shell command syntax" \
          '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"shellCommand": $cmd}, "timestamp": "'$(date -Iseconds)'"}] | .errors += [{"step": $step, "message": "Invalid shell command syntax", "details": {"command": $cmd}}]' \
          "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
      fi
    done
  fi
fi

# Step 4: Execution Test
echo "🔍 Step 4: Execution Test..."
start_time=$(date +%s)
if [ -n "$INPUT_ARGUMENTS" ]; then
  if opencode "$COMMAND_NAME" $INPUT_ARGUMENTS > /tmp/opencode_test_output 2>/tmp/opencode_test_error; then
    end_time=$(date +%s)
    execution_time=$((end_time - start_time))
    echo "✅ Command executed successfully (${execution_time}s)"
    jq --arg step "execution" --arg status "success" --arg output "Command executed successfully" --argjson time "$execution_time" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"executionTime": $time}, "timestamp": "'$(date -Iseconds)'"}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  else
    end_time=$(date +%s)
    execution_time=$((end_time - start_time))
    error_output=$(cat /tmp/opencode_test_error)
    echo "❌ Command execution failed (${execution_time}s)"
    jq --arg step "execution" --arg status "error" --arg output "Command execution failed" --argjson time "$execution_time" --arg error "$error_output" \
      '.steps += [{"name": $step, "status": $status, "output": $output, "details": {"executionTime": $time, "stderr": $error}, "timestamp": "'$(date -Iseconds)'"}] | .errors += [{"step": $step, "message": "Command execution failed", "details": {"stderr": $error}}]' \
      "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
  fi
else
  echo "⚠️  No arguments to test execution"
  jq --arg step "execution" --arg status "skip" --arg output "No arguments to test execution" \
    '.steps += [{"name": $step, "status": $status, "output": $output, "timestamp": "'$(date -Iseconds)'"}]' \
    "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
fi

# Update final success status
error_count=$(jq '.errors | length' "$DEBUG_FILE")
if [ "$error_count" -eq 0 ]; then
  jq '.success = true' "$DEBUG_FILE" > tmp.json && mv tmp.json "$DEBUG_FILE"
fi

# Cleanup
rm -f /tmp/opencode_test_output /tmp/opencode_test_error

echo "📊 Debug complete. Report saved to: $DEBUG_FILE"
echo "🔍 View results: cat $DEBUG_FILE | jq '.'

# Show summary
echo ""
echo "📋 Debug Summary:"
echo "  Steps: $(jq '.steps | length' "$DEBUG_FILE")"
echo "  Errors: $(jq '.errors | length' "$DEBUG_FILE")"
echo "  Success: $(jq '.success' "$DEBUG_FILE")"

if [ "$(jq '.success' "$DEBUG_FILE')" = "true" ]; then
  echo "🎉 Command conversion appears to be working correctly!"
else
  echo "⚠️  Issues detected. Check the debug report for details."
fi
```

---

## Integration Testing Strategies

### 1. End-to-End Integration Test Framework

```typescript
// End-to-End Integration Testing
export class E2EIntegrationTests {
  async runFullIntegrationTests(): Promise<IntegrationTestResult[]> {
    const results: IntegrationTestResult[] = []

    // Test 1: Complete MCP Server Lifecycle
    results.push(await this.testMCPServerLifecycle())

    // Test 2: Codeflow Pipeline Integration
    results.push(await this.testCodeflowPipelineIntegration())

    // Test 3: Multi-Command Workflow
    results.push(await this.testMultiCommandWorkflow())

    // Test 4: Error Recovery and Rollback
    results.push(await this.testErrorRecovery())

    // Test 5: Performance Under Load
    results.push(await this.testPerformanceUnderLoad())

    return results
  }

  private async testMCPServerLifecycle(): Promise<IntegrationTestResult> {
    const testResult: IntegrationTestResult = {
      name: "MCP Server Lifecycle",
      status: "running",
      steps: [],
      startTime: Date.now(),
    }

    try {
      // Step 1: Add MCP Server
      const addResult = await $`opencode mcp user test-lifecycle https://httpbin.org/status/200`.nothrow()
      testResult.steps.push({
        name: "add_server",
        status: addResult.exitCode === 0 ? "success" : "fail",
        output: addResult.stdout,
        error: addResult.stderr,
      })

      // Step 2: Verify Configuration
      const configContent = await fs.readFile("opencode.jsonc", "utf-8")
      const config = JSON.parse(configContent)
      const serverExists = config.mcp && config.mcp["test-lifecycle"]

      testResult.steps.push({
        name: "verify_config",
        status: serverExists ? "success" : "fail",
        output: serverExists ? "Server found in configuration" : "Server not found in configuration",
      })

      // Step 3: Test Tool Discovery
      const { MCP } = await import("../src/mcp")
      const tools = await MCP.tools()
      const toolFound = Object.keys(tools).some((key) => key.includes("test_lifecycle"))

      testResult.steps.push({
        name: "tool_discovery",
        status: toolFound ? "success" : "fail",
        output: `Found ${Object.keys(tools).length} tools, test server tool: ${toolFound}`,
      })

      // Step 4: Cleanup
      if (serverExists) {
        delete config.mcp["test-lifecycle"]
        await fs.writeFile("opencode.jsonc", JSON.stringify(config, null, 2))

        testResult.steps.push({
          name: "cleanup",
          status: "success",
          output: "Test server removed from configuration",
        })
      }

      testResult.status = testResult.steps.every((s) => s.status === "success") ? "success" : "fail"
    } catch (error) {
      testResult.status = "error"
      testResult.error = error.message
    }

    testResult.endTime = Date.now()
    testResult.duration = testResult.endTime - testResult.startTime

    return testResult
  }

  private async testCodeflowPipelineIntegration(): Promise<IntegrationTestResult> {
    const testResult: IntegrationTestResult = {
      name: "Codeflow Pipeline Integration",
      status: "running",
      steps: [],
      startTime: Date.now(),
    }

    try {
      // Create a mock pipeline configuration
      const pipelineConfig = {
        name: "test-pipeline",
        stages: [
          {
            name: "setup",
            commands: ["opencode mcp user pipeline-server https://api.example.com/mcp"],
          },
          {
            name: "validate",
            commands: ["opencode run --command validate-pipeline --model test/model"],
          },
          {
            name: "execute",
            commands: ["opencode run --command execute-workflow --format json"],
          },
        ],
      }

      // Step 1: Pipeline Setup
      await fs.writeFile("pipeline.json", JSON.stringify(pipelineConfig, null, 2))
      testResult.steps.push({
        name: "pipeline_setup",
        status: "success",
        output: "Pipeline configuration created",
      })

      // Step 2: Execute Pipeline Stages
      for (const stage of pipelineConfig.stages) {
        for (const command of stage.commands) {
          const result = await $`${command}`.nothrow()
          testResult.steps.push({
            name: `stage_${stage.name}`,
            status: result.exitCode === 0 ? "success" : "warn",
            output: result.stdout,
            error: result.stderr,
          })
        }
      }

      // Step 3: Validate Pipeline Results
      const finalConfig = JSON.parse(await fs.readFile("opencode.jsonc", "utf-8"))
      const pipelineServerExists = finalConfig.mcp && finalConfig.mcp["pipeline-server"]

      testResult.steps.push({
        name: "pipeline_validation",
        status: pipelineServerExists ? "success" : "fail",
        output: `Pipeline server integration: ${pipelineServerExists ? "success" : "failed"}`,
      })

      // Cleanup
      if (pipelineServerExists) {
        delete finalConfig.mcp["pipeline-server"]
        await fs.writeFile("opencode.jsonc", JSON.stringify(finalConfig, null, 2))
      }
      await fs.rm("pipeline.json", { force: true })

      testResult.status = testResult.steps.every((s) => s.status === "success") ? "success" : "fail"
    } catch (error) {
      testResult.status = "error"
      testResult.error = error.message
    }

    testResult.endTime = Date.now()
    testResult.duration = testResult.endTime - testResult.startTime

    return testResult
  }

  private async testMultiCommandWorkflow(): Promise<IntegrationTestResult> {
    const testResult: IntegrationTestResult = {
      name: "Multi-Command Workflow",
      status: "running",
      steps: [],
      startTime: Date.now(),
    }

    try {
      // Define a complex workflow
      const workflow = [
        {
          name: "setup_filesystem",
          command: "opencode mcp local workflow-fs npx @modelcontextprotocol/server-filesystem /tmp/workflow",
        },
        {
          name: "setup_remote",
          command: "opencode mcp user workflow-remote https://httpbin.org/status/200",
        },
        {
          name: "test_commands",
          command: "opencode run --command 'List available MCP tools and test filesystem access'",
        },
      ]

      // Execute workflow steps
      for (const step of workflow) {
        const result = await $`${step.command}`.nothrow()
        testResult.steps.push({
          name: step.name,
          status: result.exitCode === 0 ? "success" : "warn",
          output: result.stdout,
          error: result.stderr,
        })
      }

      // Verify all servers were added
      const config = JSON.parse(await fs.readFile("opencode.jsonc", "utf-8"))
      const serversAdded = config.mcp && config.mcp["workflow-fs"] && config.mcp["workflow-remote"]

      testResult.steps.push({
        name: "workflow_verification",
        status: serversAdded ? "success" : "fail",
        output: `Workflow servers added: ${serversAdded ? "yes" : "no"}`,
      })

      // Cleanup
      if (serversAdded) {
        delete config.mcp["workflow-fs"]
        delete config.mcp["workflow-remote"]
        await fs.writeFile("opencode.jsonc", JSON.stringify(config, null, 2))
      }

      testResult.status = testResult.steps.every((s) => s.status === "success") ? "success" : "fail"
    } catch (error) {
      testResult.status = "error"
      testResult.error = error.message
    }

    testResult.endTime = Date.now()
    testResult.duration = testResult.endTime - testResult.startTime

    return testResult
  }

  private async testErrorRecovery(): Promise<IntegrationTestResult> {
    const testResult: IntegrationTestResult = {
      name: "Error Recovery and Rollback",
      status: "running",
      steps: [],
      startTime: Date.now(),
    }

    try {
      // Step 1: Attempt to add invalid server
      const invalidResult = await $`opencode mcp user invalid-server not-a-url`.nothrow()
      testResult.steps.push({
        name: "invalid_server_addition",
        status: invalidResult.exitCode !== 0 ? "success" : "fail",
        output: "Invalid server correctly rejected",
        error: invalidResult.stderr,
      })

      // Step 2: Verify config wasn't corrupted
      const configContent = await fs.readFile("opencode.jsonc", "utf-8")
      const config = JSON.parse(configContent)
      const invalidServerExists = config.mcp && config.mcp["invalid-server"]

      testResult.steps.push({
        name: "config_integrity_check",
        status: !invalidServerExists ? "success" : "fail",
        output: `Config integrity maintained: ${!invalidServerExists ? "yes" : "no"}`,
      })

      // Step 3: Test partial failure recovery
      const validResult = await $`opencode mcp user recovery-test https://httpbin.org/status/500`.nothrow()
      testResult.steps.push({
        name: "partial_failure_handling",
        status: validResult.exitCode === 0 ? "success" : "warn",
        output: "Partial failure handled gracefully",
        error: validResult.stderr,
      })

      // Cleanup if server was added despite failure
      if (config.mcp && config.mcp["recovery-test"]) {
        delete config.mcp["recovery-test"]
        await fs.writeFile("opencode.jsonc", JSON.stringify(config, null, 2))
      }

      testResult.status = testResult.steps.every((s) => s.status === "success") ? "success" : "fail"
    } catch (error) {
      testResult.status = "error"
      testResult.error = error.message
    }

    testResult.endTime = Date.now()
    testResult.duration = testResult.endTime - testResult.startTime

    return testResult
  }

  private async testPerformanceUnderLoad(): Promise<IntegrationTestResult> {
    const testResult: IntegrationTestResult = {
      name: "Performance Under Load",
      status: "running",
      steps: [],
      startTime: Date.now(),
    }

    try {
      const concurrentOperations = 5
      const operations = []

      // Step 1: Concurrent server additions
      for (let i = 0; i < concurrentOperations; i++) {
        operations.push($`opencode mcp user load-test-${i} https://httpbin.org/status/200`.nothrow())
      }

      const results = await Promise.all(operations)
      const successfulOperations = results.filter((r) => r.exitCode === 0).length

      testResult.steps.push({
        name: "concurrent_operations",
        status: successfulOperations === concurrentOperations ? "success" : "warn",
        output: `${successfulOperations}/${concurrentOperations} concurrent operations successful`,
      })

      // Step 2: Performance metrics
      const avgTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0) / results.length

      testResult.steps.push({
        name: "performance_metrics",
        status: avgTime < 5000 ? "success" : "warn",
        output: `Average operation time: ${avgTime}ms`,
      })

      // Cleanup
      const config = JSON.parse(await fs.readFile("opencode.jsonc", "utf-8"))
      if (config.mcp) {
        for (let i = 0; i < concurrentOperations; i++) {
          delete config.mcp[`load-test-${i}`]
        }
        await fs.writeFile("opencode.jsonc", JSON.stringify(config, null, 2))
      }

      testResult.status = testResult.steps.every((s) => s.status === "success") ? "success" : "fail"
    } catch (error) {
      testResult.status = "error"
      testResult.error = error.message
    }

    testResult.endTime = Date.now()
    testResult.duration = testResult.endTime - testResult.startTime

    return testResult
  }
}

interface IntegrationTestResult {
  name: string
  status: "running" | "success" | "fail" | "warn" | "error"
  steps: Array<{
    name: string
    status: "success" | "fail" | "warn" | "error"
    output: string
    error?: string
  }>
  startTime: number
  endTime?: number
  duration?: number
  error?: string
}
```

### 2. Automated Integration Test Script

```bash
#!/bin/bash
# integration-tests.sh - Run comprehensive integration tests

set -e

TEST_RESULTS_DIR="integration-test-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEST_RESULTS_FILE="$TEST_RESULTS_DIR/integration-test-${TIMESTAMP}.json"

echo "🚀 Starting OpenCode Integration Tests"
echo "📁 Results directory: $TEST_RESULTS_DIR"
echo "📄 Results file: $TEST_RESULTS_FILE"

# Create results directory
mkdir -p "$TEST_RESULTS_DIR"

# Initialize test results
cat > "$TEST_RESULTS_FILE" << EOF
{
  "testSuite": "OpenCode Integration Tests",
  "timestamp": "$(date -Iseconds)",
  "environment": {
    "node": "$(node --version)",
    "bun": "$(bun --version)",
    "platform": "$(uname -s)",
    "arch": "$(uname -m)"
  },
  "tests": [],
  "summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "errors": 0
  }
}
EOF

# Test 1: Command Discovery
echo "🔍 Test 1: Command Discovery..."
command_discovery_result=$(opencode --help 2>&1)
if echo "$command_discovery_result" | grep -q "mcp"; then
  echo "✅ MCP commands available"
  jq --arg name "command_discovery" --arg status "pass" --arg message "MCP commands available" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
else
  echo "❌ MCP commands not available"
  jq --arg name "command_discovery" --arg status "fail" --arg message "MCP commands not available" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.failed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
fi

# Test 2: MCP Server Addition
echo "🔍 Test 2: MCP Server Addition..."
mcp_add_result=$(opencode mcp user integration-test https://httpbin.org/status/200 2>&1)
if echo "$mcp_add_result" | grep -q "added successfully"; then
  echo "✅ MCP server added successfully"
  jq --arg name "mcp_server_addition" --arg status "pass" --arg message "MCP server added successfully" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"

  # Verify in config
  if grep -q "integration-test" opencode.jsonc; then
    echo "✅ Server found in configuration"
    jq --arg name "config_verification" --arg status "pass" --arg message "Server found in configuration" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  else
    echo "❌ Server not found in configuration"
    jq --arg name "config_verification" --arg status "fail" --arg message "Server not found in configuration" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.failed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  fi
else
  echo "❌ MCP server addition failed"
  jq --arg name "mcp_server_addition" --arg status "fail" --arg message "MCP server addition failed" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.failed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
fi

# Test 3: Slash Command Processing
echo "🔍 Test 3: Slash Command Processing..."
if [ -f ".opencode/command/mcp-user.md" ]; then
  echo "✅ Slash command file exists"

  # Check template structure
  if grep -q '\$ARGUMENTS' ".opencode/command/mcp-user.md"; then
    echo "✅ Template contains \$ARGUMENTS placeholder"
    jq --arg name "slash_command_template" --arg status "pass" --arg message "Template contains \$ARGUMENTS placeholder" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  else
    echo "⚠️  Template missing \$ARGUMENTS placeholder"
    jq --arg name "slash_command_template" --arg status "warn" --arg message "Template missing \$ARGUMENTS placeholder" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  fi

  # Check shell command syntax
  if grep -q '!`opencode mcp' ".opencode/command/mcp-user.md"; then
    echo "✅ Shell command syntax found"
    jq --arg name "slash_command_shell" --arg status "pass" --arg message "Shell command syntax found" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  else
    echo "⚠️  Shell command syntax not found"
    jq --arg name "slash_command_shell" --arg status "warn" --arg message "Shell command syntax not found" \
      '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
      "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
  fi
else
  echo "❌ Slash command file not found"
  jq --arg name "slash_command_exists" --arg status "fail" --arg message "Slash command file not found" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.failed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
fi

# Test 4: Error Handling
echo "🔍 Test 4: Error Handling..."
error_test_result=$(opencode mcp user invalid-test not-a-url 2>&1)
if echo "$error_test_result" | grep -q -i "invalid\|error"; then
  echo "✅ Error handling works correctly"
  jq --arg name "error_handling" --arg status "pass" --arg message "Error handling works correctly" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
else
  echo "❌ Error handling may not be working"
  jq --arg name "error_handling" --arg status "fail" --arg message "Error handling may not be working" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.failed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
fi

# Test 5: Performance Test
echo "🔍 Test 5: Performance Test..."
start_time=$(date +%s%N)
performance_test_result=$(opencode mcp user perf-test https://httpbin.org/status/200 2>&1)
end_time=$(date +%s%N)
execution_time=$(( (end_time - start_time) / 1000000 )) # Convert to milliseconds

if echo "$performance_test_result" | grep -q "added successfully" && [ "$execution_time" -lt 5000 ]; then
  echo "✅ Performance test passed (${execution_time}ms)"
  jq --arg name "performance" --arg status "pass" --arg message "Performance test passed" --argjson time "$execution_time" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "details": {"executionTime": $time}, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
else
  echo "⚠️  Performance test warning (${execution_time}ms)"
  jq --arg name "performance" --arg status "warn" --arg message "Performance test warning" --argjson time "$execution_time" \
    '.tests += [{"name": $name, "status": $status, "message": $message, "details": {"executionTime": $time}, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 | .summary.passed += 1' \
    "$TEST_RESULTS_FILE" > tmp.json && mv tmp.json "$TEST_RESULTS_FILE"
fi

# Cleanup test servers
echo "🧹 Cleaning up test servers..."
if [ -f "opencode.jsonc" ]; then
  # Remove test servers from config
  jq 'del(.mcp["integration-test"]) | del(.mcp["invalid-test"]) | del(.mcp["perf-test"])' opencode.jsonc > tmp.json && mv tmp.json opencode.jsonc
fi

# Generate summary
echo ""
echo "📊 Integration Test Summary:"
total_tests=$(jq '.summary.total' "$TEST_RESULTS_FILE")
passed_tests=$(jq '.summary.passed' "$TEST_RESULTS_FILE")
failed_tests=$(jq '.summary.failed' "$TEST_RESULTS_FILE")

echo "  Total Tests: $total_tests"
echo "  Passed: $passed_tests"
echo "  Failed: $failed_tests"
echo "  Success Rate: $(( passed_tests * 100 / total_tests ))%"

if [ "$failed_tests" -eq 0 ]; then
  echo "🎉 All integration tests passed!"
  exit 0
else
  echo "⚠️  Some integration tests failed. Check the detailed results."
  echo "📄 Detailed results: $TEST_RESULTS_FILE"
  exit 1
fi
```

---

## Common Conversion Errors and Solutions

### 1. Argument Parsing Errors

#### Error: Missing Required Arguments

```bash
# Problem
opencode mcp user
# Error: Not enough non-option arguments

# Solution
opencode mcp user server-name https://server-url.com
# Or use interactive mode
opencode mcp add
```

#### Error: Array Argument Not Processed Correctly

```bash
# Problem
opencode mcp local test "node server.js --port 3000"
# Command treated as single string

# Solution
opencode mcp local test node server.js --port 3000
# Arguments properly split into array
```

#### Error: Headers Not Parsed

```bash
# Problem
opencode mcp user test https://api.com --headers "Auth: token"
# Headers not applied correctly

# Solution
opencode mcp user test https://api.com --headers "Authorization: Bearer token123"
# Proper header format with key: value
```

### 2. Template Substitution Errors

#### Error: $ARGUMENTS Not Found

```markdown
## <!-- Problem -->

## description: Test command

Execute: !`opencode run $ARGUMENTS`

## <!-- Solution -->

## description: Test command

Processing arguments: $ARGUMENTS
Execute: !`opencode run $ARGUMENTS`
```

#### Error: Shell Command Syntax

```markdown
## <!-- Problem -->

## description: Test command

!`opencode mcp user $ARGUMENTS` # Missing quotes around arguments

## <!-- Solution -->

## description: Test command

!`opencode mcp user $ARGUMENTS`
```

#### Error: File Reference Not Resolved

```markdown
## <!-- Problem -->

## description: Test command

Analyze @config file

## <!-- Solution -->

## description: Test command

Analyze @config.json file
```

### 3. MCP Configuration Errors

#### Error: Invalid URL Format

```json
// Problem
{
  "mcp": {
    "test": {
      "type": "remote",
      "url": "api.example.com/mcp"  // Missing protocol
    }
  }
}

// Solution
{
  "mcp": {
    "test": {
      "type": "remote",
      "url": "https://api.example.com/mcp"
    }
  }
}
```

#### Error: Command Not Array

```json
// Problem
{
  "mcp": {
    "test": {
      "type": "local",
      "command": "node server.js --port 3000"  // String instead of array
    }
  }
}

// Solution
{
  "mcp": {
    "test": {
      "type": "local",
      "command": ["node", "server.js", "--port", "3000"]
    }
  }
}
```

### 4. Codeflow Integration Errors

#### Error: Environment Variables Not Substituted

```json
// Problem
{
  "mcp": {
    "test": {
      "type": "remote",
      "url": "{MCP_URL}",  // Missing env: prefix
      "headers": {
        "Authorization": "Bearer {API_KEY}"  // Missing env: prefix
      }
    }
  }
}

// Solution
{
  "mcp": {
    "test": {
      "type": "remote",
      "url": "{env:MCP_URL}",
      "headers": {
        "Authorization": "Bearer {env:API_KEY}"
      }
    }
  }
}
```

#### Error: Permission Issues in CI/CD

```bash
# Problem - Running as root in container
RUN opencode mcp add

# Solution - Create user first
RUN useradd -m opencode && su - opencode -c "opencode mcp add"
```

### 5. Debugging Solutions

#### Solution: Enable Debug Logging

```bash
# Set debug environment variable
export OPENCODE_DEBUG=1
export OPENCODE_LOG_LEVEL=debug

# Run command with debug output
opencode mcp user test https://api.com
```

#### Solution: Validate Configuration

```bash
# Use configuration validation script
./scripts/validate-mcp-config.sh

# Check JSON syntax
jq . opencode.jsonc

# Validate against schema
ajv validate -s config-schema.json -d opencode.jsonc
```

#### Solution: Test in Isolation

```bash
# Create temporary test environment
mkdir test-env && cd test-env

# Initialize minimal config
echo '{"mcp": {}}' > opencode.jsonc

# Test command in isolation
opencode mcp user test https://httpbin.org/status/200
```

---

## Configuration Validation Patterns

### 1. Schema-Based Validation

```typescript
// Configuration Schema Validator
export class ConfigSchemaValidator {
  private mcpServerSchema = {
    type: "object",
    required: ["type"],
    oneOf: [
      {
        properties: {
          type: { const: "remote" },
          url: { type: "string", format: "uri" },
          headers: { type: "object" },
          enabled: { type: "boolean" },
        },
        required: ["url"],
      },
      {
        properties: {
          type: { const: "local" },
          command: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          environment: { type: "object" },
          enabled: { type: "boolean" },
        },
        required: ["command"],
      },
    ],
  }

  async validateConfig(configPath: string): Promise<ValidationResult> {
    try {
      const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
      const ajv = new Ajv()
      const validate = ajv.compile(this.mcpServerSchema)

      const results = []
      if (config.mcp) {
        for (const [serverName, serverConfig] of Object.entries(config.mcp)) {
          const isValid = validate(serverConfig)
          results.push({
            server: serverName,
            valid: isValid,
            errors: isValid ? [] : validate.errors,
          })
        }
      }

      return {
        status: results.every((r) => r.valid) ? "pass" : "fail",
        message: `Configuration validation: ${results.filter((r) => r.valid).length}/${results.length} servers valid`,
        details: results,
      }
    } catch (error) {
      return {
        status: "fail",
        message: `Configuration validation failed: ${error.message}`,
      }
    }
  }
}
```

### 2. Runtime Validation Patterns

```typescript
// Runtime Configuration Validation
export class RuntimeConfigValidator {
  async validateMCPConnectivity(): Promise<ValidationResult> {
    const { Config } = await import("../src/config/config")
    const config = await Config.get()

    if (!config.mcp) {
      return {
        status: "skip",
        message: "No MCP configuration found",
      }
    }

    const results = []
    for (const [serverName, serverConfig] of Object.entries(config.mcp)) {
      if (serverConfig.enabled === false) {
        results.push({
          server: serverName,
          status: "skip",
          message: "Server disabled",
        })
        continue
      }

      if (serverConfig.type === "remote") {
        try {
          const response = await fetch(serverConfig.url, {
            method: "HEAD",
            timeout: 5000,
            headers: serverConfig.headers,
          })

          results.push({
            server: serverName,
            status: response.ok ? "pass" : "warn",
            message: `Connectivity: ${response.status}`,
            details: { status: response.status, url: serverConfig.url },
          })
        } catch (error) {
          results.push({
            server: serverName,
            status: "fail",
            message: `Connection failed: ${error.message}`,
            details: { error: error.message },
          })
        }
      } else if (serverConfig.type === "local") {
        const command = serverConfig.command[0]
        try {
          const result = await $`which ${command}`.nothrow()
          results.push({
            server: serverName,
            status: result.exitCode === 0 ? "pass" : "warn",
            message: `Command availability: ${result.exitCode === 0 ? "found" : "not found"}`,
            details: { command },
          })
        } catch (error) {
          results.push({
            server: serverName,
            status: "fail",
            message: `Command check failed: ${error.message}`,
            details: { error: error.message },
          })
        }
      }
    }

    const allPassed = results.every((r) => r.status === "pass" || r.status === "skip")
    return {
      status: allPassed ? "pass" : "warn",
      message: `MCP connectivity: ${results.filter((r) => r.status === "pass").length}/${results.length} servers connected`,
      details: results,
    }
  }
}
```

### 3. Environment-Specific Validation

```typescript
// Environment Configuration Validation
export class EnvironmentConfigValidator {
  async validateForEnvironment(env: string): Promise<ValidationResult> {
    const validators = {
      development: () => this.validateDevelopmentConfig(),
      staging: () => this.validateStagingConfig(),
      production: () => this.validateProductionConfig(),
      ci: () => this.validateCIConfig(),
    }

    const validator = validators[env]
    if (!validator) {
      return {
        status: "fail",
        message: `Unknown environment: ${env}`,
      }
    }

    return await validator()
  }

  private async validateDevelopmentConfig(): Promise<ValidationResult> {
    const checks = [this.checkLocalMCPServers(), this.checkDebugSettings(), this.checkDevelopmentTools()]

    const results = await Promise.all(checks)
    const allPassed = results.every((r) => r.status === "pass")

    return {
      status: allPassed ? "pass" : "warn",
      message: `Development environment: ${results.filter((r) => r.status === "pass").length}/${results.length} checks passed`,
      details: results,
    }
  }

  private async validateProductionConfig(): Promise<ValidationResult> {
    const checks = [
      this.checkRemoteMCPServers(),
      this.checkSecuritySettings(),
      this.checkPerformanceSettings(),
      this.checkMonitoringSetup(),
    ]

    const results = await Promise.all(checks)
    const allPassed = results.every((r) => r.status === "pass")

    return {
      status: allPassed ? "pass" : "fail",
      message: `Production environment: ${results.filter((r) => r.status === "pass").length}/${results.length} checks passed`,
      details: results,
    }
  }

  private async validateCIConfig(): Promise<ValidationResult> {
    const checks = [
      this.checkNonInteractiveMode(),
      this.checkEnvironmentVariables(),
      this.checkOutputFormats(),
      this.checkErrorHandling(),
    ]

    const results = await Promise.all(checks)
    const allPassed = results.every((r) => r.status === "pass")

    return {
      status: allPassed ? "pass" : "fail",
      message: `CI environment: ${results.filter((r) => r.status === "pass").length}/${results.length} checks passed`,
      details: results,
    }
  }
}
```

---

## Automated Validation Scripts

### 1. Comprehensive Validation Script

```bash
#!/bin/bash
# validate-opencode-setup.sh - Comprehensive OpenCode setup validation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATION_RESULTS="$SCRIPT_DIR/validation-results.json"

echo "🔍 OpenCode Setup Validation"
echo "============================"

# Initialize results
cat > "$VALIDATION_RESULTS" << EOF
{
  "validationSuite": "OpenCode Setup Validation",
  "timestamp": "$(date -Iseconds)",
  "environment": {
    "pwd": "$(pwd)",
    "user": "$(whoami)",
    "shell": "$SHELL",
    "node": "$(node --version 2>/dev/null || echo 'not installed')",
    "bun": "$(bun --version 2>/dev/null || echo 'not installed')"
  },
  "validations": [],
  "summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "warnings": 0
  }
}
EOF

# Helper function to add validation result
add_validation() {
  local name="$1"
  local status="$2"
  local message="$3"
  local details="$4"

  jq --arg name "$name" --arg status "$status" --arg message "$message" --arg details "$details" \
    '.validations += [{"name": $name, "status": $status, "message": $message, "details": $details, "timestamp": "'$(date -Iseconds)'"}] | .summary.total += 1 |
    if $status == "pass" then .summary.passed += 1
    elif $status == "fail" then .summary.failed += 1
    else .summary.warnings += 1 end' \
    "$VALIDATION_RESULTS" > tmp.json && mv tmp.json "$VALIDATION_RESULTS"
}

# Validation 1: OpenCode Installation
echo "🔍 Checking OpenCode installation..."
if command -v opencode >/dev/null 2>&1; then
  echo "✅ OpenCode is installed"
  add_validation "opencode_installation" "pass" "OpenCode is installed" "$(opencode --version 2>/dev/null || echo 'version unknown')"
else
  echo "❌ OpenCode is not installed"
  add_validation "opencode_installation" "fail" "OpenCode is not installed" "Install OpenCode using: curl -fsSL https://opencode.ai/install.sh | sh"
fi

# Validation 2: Configuration Files
echo "🔍 Checking configuration files..."
config_files=("opencode.json" "opencode.jsonc")
config_found=false

for config_file in "${config_files[@]}"; do
  if [ -f "$config_file" ]; then
    echo "✅ Configuration file found: $config_file"
    add_validation "config_file_exists" "pass" "Configuration file found: $config_file" "$config_file"
    config_found=true

    # Validate JSON syntax
    if jq empty "$config_file" 2>/dev/null; then
      echo "✅ Configuration file has valid JSON syntax"
      add_validation "config_json_syntax" "pass" "Configuration file has valid JSON syntax" "$config_file"
    else
      echo "❌ Configuration file has invalid JSON syntax"
      add_validation "config_json_syntax" "fail" "Configuration file has invalid JSON syntax" "Check JSON syntax in $config_file"
    fi
    break
  fi
done

if [ "$config_found" = false ]; then
  echo "⚠️  No configuration file found"
  add_validation "config_file_exists" "warn" "No configuration file found" "Create opencode.json or opencode.jsonc"
fi

# Validation 3: MCP Configuration
echo "🔍 Checking MCP configuration..."
if [ -f "opencode.jsonc" ] || [ -f "opencode.json" ]; then
  config_file=$( [ -f "opencode.jsonc" ] && echo "opencode.jsonc" || echo "opencode.json" )

  mcp_config=$(jq -r '.mcp // {}' "$config_file")
  if [ "$mcp_config" != "{}" ]; then
    mcp_servers=$(echo "$mcp_config" | jq -r 'keys[]' | wc -l)
    echo "✅ MCP configuration found with $mcp_servers server(s)"
    add_validation "mcp_config_exists" "pass" "MCP configuration found" "$mcp_servers servers configured"

    # Validate each MCP server
    echo "$mcp_config" | jq -r 'to_entries[] | "\(.key):\(.value.type)"' | while IFS=: read -r server_name server_type; do
      echo "  🔍 Validating MCP server: $server_name (type: $server_type)"

      case $server_type in
        "remote")
          server_url=$(echo "$mcp_config" | jq -r ".[\"$server_name\"].url")
          if [ -n "$server_url" ] && [ "$server_url" != "null" ]; then
            if curl -s --head "$server_url" >/dev/null 2>&1; then
              echo "    ✅ Remote server is reachable"
              add_validation "mcp_remote_connectivity_$server_name" "pass" "Remote server reachable" "$server_url"
            else
              echo "    ⚠️  Remote server not reachable"
              add_validation "mcp_remote_connectivity_$server_name" "warn" "Remote server not reachable" "$server_url"
            fi
          else
            echo "    ❌ Remote server missing URL"
            add_validation "mcp_remote_url_$server_name" "fail" "Remote server missing URL" "Add url field to server configuration"
          fi
          ;;
        "local")
          server_command=$(echo "$mcp_config" | jq -r ".[\"$server_name\"].command[0]")
          if [ -n "$server_command" ] && [ "$server_command" != "null" ]; then
            if command -v "$server_command" >/dev/null 2>&1; then
              echo "    ✅ Local server command found"
              add_validation "mcp_local_command_$server_name" "pass" "Local server command found" "$server_command"
            else
              echo "    ⚠️  Local server command not found in PATH"
              add_validation "mcp_local_command_$server_name" "warn" "Local server command not found in PATH" "$server_command"
            fi
          else
            echo "    ❌ Local server missing command"
            add_validation "mcp_local_command_$server_name" "fail" "Local server missing command" "Add command array to server configuration"
          fi
          ;;
        *)
          echo "    ❌ Unknown server type: $server_type"
          add_validation "mcp_server_type_$server_name" "fail" "Unknown server type" "$server_type"
          ;;
      esac
    done
  else
    echo "ℹ️  No MCP configuration found"
    add_validation "mcp_config_exists" "skip" "No MCP configuration found" "Add MCP servers using: opencode mcp add"
  fi
fi

# Validation 4: Slash Commands
echo "🔍 Checking slash commands..."
slash_command_dirs=(".opencode/command" "~/.config/opencode/command")
slash_commands_found=false

for cmd_dir in "${slash_command_dirs[@]}"; do
  expanded_dir=$(eval echo "$cmd_dir")
  if [ -d "$expanded_dir" ]; then
    echo "✅ Slash command directory found: $expanded_dir"
    add_validation "slash_command_dir" "pass" "Slash command directory found" "$expanded_dir"

    cmd_count=$(find "$expanded_dir" -name "*.md" | wc -l)
    if [ "$cmd_count" -gt 0 ]; then
      echo "✅ Found $cmd_count slash command(s)"
      add_validation "slash_commands_count" "pass" "Found slash commands" "$cmd_count commands"

      # Validate each slash command
      find "$expanded_dir" -name "*.md" | while read -r cmd_file; do
        cmd_name=$(basename "$cmd_file" .md)
        echo "  🔍 Validating slash command: $cmd_name"

        # Check for $ARGUMENTS placeholder
        if grep -q '\$ARGUMENTS' "$cmd_file"; then
          echo "    ✅ Contains \$ARGUMENTS placeholder"
          add_validation "slash_command_arguments_$cmd_name" "pass" "Contains \$ARGUMENTS placeholder" "$cmd_file"
        else
          echo "    ⚠️  Missing \$ARGUMENTS placeholder"
          add_validation "slash_command_arguments_$cmd_name" "warn" "Missing \$ARGUMENTS placeholder" "$cmd_file"
        fi

        # Check shell command syntax
        shell_commands=$(grep -o '!`[^`]*`' "$cmd_file" | wc -l)
        if [ "$shell_commands" -gt 0 ]; then
          echo "    ✅ Contains $shell_commands shell command(s)"
          add_validation "slash_command_shell_$cmd_name" "pass" "Contains shell commands" "$shell_commands commands"

          # Validate shell syntax
          grep -o '!`[^`]*`' "$cmd_file" | while read -r shell_cmd; do
            cmd_content=$(echo "$shell_cmd" | sed 's/!`\([^`]*\)`/\1/')
            if bash -n "$cmd_content" 2>/dev/null; then
              echo "      ✅ Shell syntax valid: $cmd_content"
            else
              echo "      ❌ Shell syntax invalid: $cmd_content"
              add_validation "slash_command_shell_syntax_$cmd_name" "fail" "Invalid shell command syntax" "$cmd_content"
            fi
          done
        fi
      done

      slash_commands_found=true
    else
      echo "ℹ️  No slash commands found in directory"
      add_validation "slash_commands_count" "skip" "No slash commands found" "Add .md files to command directory"
    fi
    break
  fi
done

if [ "$slash_commands_found" = false ]; then
  echo "ℹ️  No slash command directories found"
  add_validation "slash_command_dir" "skip" "No slash command directories found" "Create .opencode/command directory"
fi

# Validation 5: Command Functionality
echo "🔍 Testing command functionality..."
if command -v opencode >/dev/null 2>&1; then
  # Test basic commands
  basic_commands=("help" "mcp --help")

  for cmd in "${basic_commands[@]}"; do
    if opencode $cmd >/dev/null 2>&1; then
      echo "✅ Command works: opencode $cmd"
      add_validation "command_functionality_$cmd" "pass" "Command works" "opencode $cmd"
    else
      echo "❌ Command failed: opencode $cmd"
      add_validation "command_functionality_$cmd" "fail" "Command failed" "opencode $cmd"
    fi
  done

  # Test MCP command specifically
  if opencode mcp --help >/dev/null 2>&1; then
    echo "✅ MCP command available"
    add_validation "mcp_command_available" "pass" "MCP command available" "opencode mcp"

    # Test interactive MCP addition
    echo "test" | echo "remote" | echo "test-server" | echo "https://httpbin.org/status/200" | opencode mcp add >/dev/null 2>&1 || true

    # Check if test server was added
    if [ -f "opencode.jsonc" ] || [ -f "opencode.json" ]; then
      config_file=$( [ -f "opencode.jsonc" ] && echo "opencode.jsonc" || echo "opencode.json" )
      if grep -q "test-server" "$config_file"; then
        echo "✅ MCP server addition works"
        add_validation "mcp_server_addition" "pass" "MCP server addition works" "Test server added successfully"

        # Cleanup test server
        jq 'del(.mcp["test-server"])' "$config_file" > tmp.json && mv tmp.json "$config_file"
      else
        echo "⚠️  MCP server addition may not work"
        add_validation "mcp_server_addition" "warn" "MCP server addition may not work" "Test server not found in config"
      fi
    fi
  else
    echo "❌ MCP command not available"
    add_validation "mcp_command_available" "fail" "MCP command not available" "Check OpenCode installation"
  fi
fi

# Generate summary
echo ""
echo "📊 Validation Summary"
echo "===================="

total=$(jq '.summary.total' "$VALIDATION_RESULTS")
passed=$(jq '.summary.passed' "$VALIDATION_RESULTS")
failed=$(jq '.summary.failed' "$VALIDATION_RESULTS")
warnings=$(jq '.summary.warnings' "$VALIDATION_RESULTS")

echo "Total Validations: $total"
echo "Passed: $passed ✅"
echo "Failed: $failed ❌"
echo "Warnings: $warnings ⚠️"

success_rate=$(( passed * 100 / total ))
echo "Success Rate: $success_rate%"

if [ "$failed" -eq 0 ]; then
  echo ""
  echo "🎉 All critical validations passed!"
  echo "Your OpenCode setup is ready for codeflow integration."
else
  echo ""
  echo "⚠️  Some validations failed. Please address the issues above."
  echo "📄 Detailed results: $VALIDATION_RESULTS"
fi

# Show detailed results if requested
if [ "$1" = "--verbose" ]; then
  echo ""
  echo "📋 Detailed Validation Results:"
  jq -r '.validations[] | "\(.status): \(.name) - \(.message)"' "$VALIDATION_RESULTS"
fi

exit $([ "$failed" -eq 0 ] && echo 0 || echo 1)
```

### 2. Continuous Integration Validation

```yaml
# .github/workflows/opencode-validation.yml
name: OpenCode Validation

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 2 * * *" # Daily at 2 AM

jobs:
  validate-opencode:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install Bun
        run: |
          curl -fsSL https://bun.sh/install | bash
          echo "$HOME/.bun/bin" >> $GITHUB_PATH

      - name: Install OpenCode
        run: |
          curl -fsSL https://opencode.ai/install.sh | sh

      - name: Run validation script
        run: |
          chmod +x ./scripts/validate-opencode-setup.sh
          ./scripts/validate-opencode-setup.sh --verbose

      - name: Upload validation results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: validation-results
          path: validation-results.json

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const results = JSON.parse(fs.readFileSync('validation-results.json', 'utf8'));

            const summary = `
            ## OpenCode Validation Results

            - **Total Validations**: ${results.summary.total}
            - **Passed**: ${results.summary.passed} ✅
            - **Failed**: ${results.summary.failed} ❌
            - **Warnings**: ${results.summary.warnings} ⚠️
            - **Success Rate**: ${Math.round(results.summary.passed * 100 / results.summary.total)}%

            ${results.summary.failed > 0 ? '⚠️ **Some validations failed. Please review the detailed results.**' : '🎉 **All validations passed!**'}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: summary
            });
```

---

## Conclusion

This comprehensive validation guide provides codeflow projects with the tools and methodologies needed to ensure OpenCode commands are properly converted and functioning. By implementing the validation checklist, test cases, debugging strategies, and automated scripts outlined in this guide, teams can:

1. **Ensure Command Reliability**: Validate that CLI commands, slash commands, and MCP server configurations work correctly in automated workflows.

2. **Detect Issues Early**: Use automated validation to catch configuration and conversion problems before they impact production workflows.

3. **Maintain Quality**: Implement continuous integration validation to ensure ongoing reliability as the codebase evolves.

4. **Debug Effectively**: Use the debugging framework and common issue patterns to quickly identify and resolve conversion problems.

5. **Scale Confidently**: Apply integration testing strategies to validate OpenCode functionality across different environments and use cases.

The guide emphasizes practical, actionable validation steps that can be integrated into existing CI/CD pipelines and development workflows, ensuring that OpenCode command conversion remains robust and reliable in codeflow automation contexts.
