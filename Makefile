# openloop — developer Makefile
# Thin wrappers around the existing bun/turbo scripts so common tasks
# don't require remembering package paths. Run `make help` for the list.
#
# Prerequisites: bun (see package.json "packageManager") and turbo (installed
# as a dev dependency; available via `bun turbo` after `make install`).

# Use bash for recipes.
SHELL := /bin/bash

# Default target: show help.
.DEFAULT_GOAL := help

.PHONY: help check-bun install run run-desktop build build-cli build-desktop test typecheck lint clean

help: ## Show this help
	@echo "openloop — available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# Fail early with a helpful message if bun is missing, instead of the cryptic
# "make: bun: No such file or directory". All bun-dependent targets require it.
check-bun:
	@command -v bun >/dev/null 2>&1 || { \
		echo "error: 'bun' is not installed or not on PATH."; \
		echo "Install it with one of:"; \
		echo "  curl -fsSL https://bun.sh/install | bash"; \
		echo "  brew install oven-sh/bun/bun"; \
		echo "Then restart your shell (or: source ~/.zshrc) so ~/.bun/bin is on PATH."; \
		exit 1; \
	}

install: check-bun ## Install dependencies (bun install)
	bun install

run: check-bun ## Run the CLI in dev mode
	bun run dev

run-desktop: check-bun ## Run the desktop app (Electron) in dev mode
	bun run dev:desktop

build: check-bun ## Build the whole monorepo
	bun turbo build

build-cli: check-bun ## Build only the CLI
	bun run --cwd packages/opencode build

build-desktop: check-bun ## Package the desktop app
	bun --cwd packages/desktop package

test: check-bun ## Run tests (via turbo; root `bun test` is intentionally disabled)
	bun turbo test

typecheck: check-bun ## Type-check the monorepo
	bun turbo typecheck

lint: check-bun ## Run the linter (oxlint)
	bun run lint

clean: ## Remove build artifacts and turbo cache
	rm -rf packages/*/dist packages/desktop/out .turbo packages/*/.turbo
