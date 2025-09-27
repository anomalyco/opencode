# EvalOps Integration for OpenCode

This fork of OpenCode adds comprehensive EvalOps integration, enabling continuous evaluation and testing of AI-generated code directly within the OpenCode environment.

## Features

### 🎯 Core Capabilities

- **Automatic Evaluation**: Runs evaluation suites automatically after AI sessions complete
- **Manual Triggering**: Execute evaluations on-demand via API or TUI commands
- **Real-time Results**: Stream evaluation results through SSE to the TUI
- **Telemetry & Analytics**: Send evaluation metrics to EvalOps for aggregation
- **Custom Evaluation Suites**: Define project-specific evaluation criteria
- **TUI Integration**: View evaluation results directly in the terminal UI

### 🔧 Components Added

1. **EvalOps Tool** (`evalops.ts`): Core tool for running evaluations
2. **API Endpoints**: REST endpoints for manual evaluation control
3. **Configuration Schema**: Extended config to support EvalOps settings
4. **TUI Dialog**: Interactive evaluation results viewer
5. **Event System**: Real-time updates via Server-Sent Events
6. **Example Suite**: Sample code quality evaluation suite

## Installation

```bash
# Clone the EvalOps-enhanced OpenCode
git clone https://github.com/evalops/opencode.git
cd opencode

# Install dependencies
bun install

# Run the development server
bun run dev
```

## Configuration

Add EvalOps settings to your `opencode.json`:

```json
{
  "evalops": {
    "enabled": true,
    "defaultSuite": "code-quality",
    "autoRun": true,
    "telemetry": true,
    "apiUrl": "https://evalops.example.com/api",
    "apiToken": "your-api-token"
  }
}
```

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | false | Enable EvalOps integration |
| `apiUrl` | string | - | EvalOps API endpoint for remote evaluation |
| `apiToken` | string | - | Authentication token for EvalOps API |
| `defaultSuite` | string | - | Default evaluation suite to run automatically |
| `autoRun` | boolean | false | Automatically run evaluations after sessions |
| `telemetry` | boolean | true | Send telemetry data to EvalOps |

## Usage

### Using the EvalOps Tool

The AI assistant can use the `evalops` tool to run evaluations:

```
Please run the code quality evaluation suite
```

### Manual API Calls

```bash
# Run evaluation suite
curl -X POST http://localhost:3000/evalops/run \
  -H "Content-Type: application/json" \
  -d '{
    "sessionID": "session-123",
    "suite": "code-quality"
  }'

# Get evaluation configuration
curl http://localhost:3000/evalops/config

# Get results for a session
curl http://localhost:3000/evalops/results/session-123
```

### TUI Commands

- **Ctrl+E**: Run default evaluation suite
- **Ctrl+Shift+E**: View evaluation results
- **/evalops**: Open evaluation dialog

## Creating Custom Evaluation Suites

Create evaluation scripts in `.opencode/evaluations/`:

```javascript
// .opencode/evaluations/my-suite.js
#!/usr/bin/env bun

const payload = JSON.parse(process.env.EVALOPS_PAYLOAD || "{}")

const tests = [
  {
    name: "Test Name",
    async run() {
      // Run your test logic
      return {
        passed: true,
        output: "Test output",
        error: null
      }
    }
  }
]

// Run evaluation and output JSON results
async function runEvaluation() {
  const results = {
    suite: "my-suite",
    tests: [],
    summary: { total: 0, passed: 0, failed: 0, duration: 0 },
    timestamp: new Date().toISOString()
  }

  // Run tests and populate results...

  console.log(JSON.stringify(results))
}

if (import.meta.main) {
  runEvaluation()
}
```

## Architecture

### Event Flow

1. **Session Completion** → EvalOps checks if auto-run is enabled
2. **Evaluation Triggered** → Tool executes evaluation suite
3. **Results Generated** → Events emitted via Bus system
4. **SSE Streaming** → Results pushed to TUI in real-time
5. **TUI Display** → Interactive dialog shows test results

### Integration Points

- **Tool Registry**: EvalOps tool registered alongside built-in tools
- **Session Hooks**: Auto-evaluation on session idle event
- **Server API**: RESTful endpoints for external integration
- **Config System**: First-class configuration support
- **Bus Events**: Real-time event streaming infrastructure

## Development

### Running Tests

```bash
# Run EvalOps integration tests
bun test src/tool/evalops.test.ts

# Run all tests
bun test
```

### Building

```bash
# Build the project
bun run build

# Type checking
bun run typecheck
```

## API Reference

### Tools

#### evalops

Runs an evaluation suite against the current project.

**Parameters:**
- `suite` (string): Name of the evaluation suite to run
- `options` (object, optional):
  - `timeout`: Timeout in milliseconds
  - `parallel`: Run tests in parallel
  - `filter`: Filter tests by pattern

### Events

#### evalops.test.started

Emitted when evaluation begins.

```typescript
{
  sessionID: string
  messageID: string
  suite: string
  tests: string[]
}
```

#### evalops.test.completed

Emitted when evaluation completes.

```typescript
{
  sessionID: string
  messageID: string
  results: EvalOpsResults
}
```

### REST API

#### POST /evalops/run

Run an evaluation suite.

**Request:**
```json
{
  "sessionID": "session-123",
  "suite": "code-quality",
  "options": {
    "timeout": 30000,
    "parallel": true
  }
}
```

**Response:**
```json
{
  "suite": "code-quality",
  "tests": [...],
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 2,
    "duration": 1234
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### GET /evalops/config

Get current EvalOps configuration.

#### GET /evalops/results/:sessionID

Get evaluation results for a specific session.

## Troubleshooting

### EvalOps not running automatically

1. Check that `evalops.enabled` is `true` in config
2. Verify `evalops.autoRun` is enabled
3. Ensure `evalops.defaultSuite` is specified

### Evaluation suite not found

1. Check suite exists in `.opencode/evaluations/`
2. Verify file has execute permissions
3. Ensure file exports valid evaluation format

### API connection issues

1. Verify `evalops.apiUrl` is correct
2. Check `evalops.apiToken` is valid
3. Ensure network connectivity to EvalOps server

## Contributing

Contributions are welcome! Please see the main OpenCode contributing guidelines.

### Areas for Enhancement

- [ ] Result persistence and history
- [ ] More sophisticated evaluation suites
- [ ] Integration with CI/CD pipelines
- [ ] Custom metrics and scoring algorithms
- [ ] Evaluation suite marketplace
- [ ] Visual regression testing support

## License

MIT (same as OpenCode)

## Credits

Built on top of the excellent [OpenCode](https://github.com/sst/opencode) project by SST.