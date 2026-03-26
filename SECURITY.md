# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Threat Model

### Overview

OpenCode is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

OpenCode does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run OpenCode inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `OPENCODE_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

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

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue, please use the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/anomalyco/opencode/security/advisories/new) tab.

The team will send a response indicating the next steps in handling your report. After the initial reply to your report, the security team will keep you informed of the progress towards a fix and full announcement, and may ask for additional information or guidance.

## Escalation

If you do not receive an acknowledgement of your report within 6 business days, you may send an email to security@anoma.ly

---

# CoBuilder Security Layers

CoBuilder extends OpenCode with a defense-in-depth security module. To report CoBuilder-specific vulnerabilities, email **security@cobuilder.dev**. We commit to acknowledging reports within **48 hours**.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| main    | Yes       |

## Security Layers Implemented

**SSRF Protection** (`src/security/ssrf.ts`)
Validates all provider URLs before network requests. Blocks cloud metadata endpoints (AWS IMDSv1, GCP metadata), private IP ranges (RFC 1918), and loopback addresses in production. Localhost is explicitly allowed for 9Router.

**Prompt Injection Scanning** (`src/security/prompt-injection.ts`)
Scans text for override patterns, data exfiltration attempts, shell injection sequences, and known jailbreak markers before passing to AI providers.

**Path Traversal Prevention** (`src/security/path.ts`)
Canonicalizes file paths and enforces base-directory confinement. Strips NUL bytes and rejects any resolved path that escapes the declared base.

**Token Bucket Rate Limiting** (`src/security/rate-limiter.ts`)
Per-key cost-aware rate limiter with configurable token refill and automatic stale-entry cleanup.

**Merkle-Chained Audit Log** (`src/security/audit.ts`)
Append-only event log where each entry includes a SHA-256 hash chained from the previous entry, providing tamper-evident logging.

**HTTP Security Headers** (`src/security/headers.ts`)
All HTTP responses include: Content-Security-Policy, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, and Strict-Transport-Security (HSTS).
