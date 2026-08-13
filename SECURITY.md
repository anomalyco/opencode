# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

moks is a TUI-first agent harness for engineering TAs. It is a hard fork of
OpenCode and is not affiliated with OpenCode. It runs locally and gives the
agent tools including shell execution, file operations, and web access.

### No Sandbox

moks does **not** sandbox the agent. The permission system exists as a UX
feature to help users stay aware of what actions the agent is taking — it
prompts for confirmation before executing commands, writing files, etc.
However, it is not designed to provide security isolation.

If you need true isolation, run moks inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `OPENCODE_SERVER_PASSWORD` to
require HTTP Basic Auth. Without this, the server runs unauthenticated (with a
warning). It is the end user's responsibility to secure the server — any
functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**      | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings.

To report a security issue, use the GitHub Security Advisory
["Report a Vulnerability"](https://github.com/artemysone/moks/security/advisories/new)
tab on **artemysone/moks**.
