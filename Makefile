# Makefile for managing local custom build and syncing upstream

# Detect current branch
CURRENT_BRANCH := $(shell git branch --show-current)

# Build binary path
BUILD_PATH := ./packages/opencode/dist/opencode-darwin-arm64/bin/opencode

.PHONY: all build install-bun sync clean test deps

# Default target
all: build

# Track dependencies installation
node_modules: package.json bun.lock
	bun install
	@touch node_modules

# Manual target to force install dependencies
deps: node_modules

# Install Bun if not present
install-bun:
	@if ! command -v bun >/dev/null 2>&1; then \
		echo "Bun not found. Installing via Homebrew..."; \
		brew install oven-sh/bun/bun; \
	else \
		echo "Bun is already installed."; \
	fi

# Build custom standalone binary
build: install-bun node_modules
	bun ./packages/opencode/script/build.ts --single

# Clean build artifacts
clean:
	rm -rf ./packages/opencode/dist
	rm -rf node_modules

# Run tests within package directories (to satisfy repo constraints)
test: install-bun node_modules
	bun run --cwd packages/opencode test

# Sync dev branch with upstream and merge into active custom branch
sync:
	@if [ "$(CURRENT_BRANCH)" = "dev" ] || [ -z "$(CURRENT_BRANCH)" ]; then \
		echo "Error: Must be on a custom feature branch to sync, not 'dev' or detached HEAD."; \
		exit 1; \
	fi
	@echo "Syncing dev with upstream, then merging into '$(CURRENT_BRANCH)'..."
	git checkout dev
	git pull upstream dev
	git push origin dev
	git checkout $(CURRENT_BRANCH)
	git merge dev
