#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import { runMcpServer } from "./mcp.ts"

runMcpServer.pipe(NodeRuntime.runMain)
