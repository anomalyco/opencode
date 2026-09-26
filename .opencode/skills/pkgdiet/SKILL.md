---
name: pkgdiet-dependency-guardrail
description: Prevents OpenCode from installing deprecated or unhealthy npm packages by enforcing pre-install checks.
---

# Dependency Management Policy

You have access to the `pkgdiet` MCP server. Whenever you are about to suggest or run an `npm install`, `yarn add`, or `pnpm add` command, you MUST follow these rules:

1. **Pre-Check:** Call the `check_dependency` tool on every package you intend to install.
2. **Handle ALLOW:** If the verdict is ALLOW, you may proceed with the installation.
3. **Handle BLOCK:** If the verdict is BLOCK, you MUST NOT install the package. Call the `suggest_alternative` tool to find a modern replacement, and ask the user for permission to install the replacement instead.
4. **Handle WARN:** If the verdict is WARN, inform the user of the health score/size impact and ask if they still want to proceed.
