#!/bin/bash
PATH=~/.bun/bin:$PATH bun run --cwd packages/opencode test-schema.ts
