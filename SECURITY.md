# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

OpenCode is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### Sandboxing

On macOS, OpenCode can optionally sandbox agent-issued non-interactive shell commands executed through the bash tool and the session command execution path. This is opt-in and off by default.

The following are **not** covered by the sandbox:

- PTY sessions (interactive shells)
- MCP server processes
- LSP server processes
- Other local process launches
- All non-macOS platforms

The permission system (confirmation prompts before commands, file writes, etc.) remains a UX layer, not a security boundary. A sandbox denial can still block a command that the permission system allowed.

For stronger isolation, run OpenCode inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `OPENCODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                              | Rationale                                                               |
| ------------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in**       | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes (uncovered paths)** | PTY, MCP, LSP, and non-macOS execution are not sandboxed                |
| **LLM provider data handling**        | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**               | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**            | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/anomalyco/opencode/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply to your report, the security team will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Escalation

If you do not receive an acknowledgement of your report within 6 business days, you may send an email to security@anoma.ly
