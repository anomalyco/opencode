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

.PHONY: help install run run-desktop build build-cli build-desktop test typecheck lint clean

help: ## Show this help
	@echo "openloop — available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (bun install)
	bun install

run: ## Run the CLI in dev mode
	bun run dev

run-desktop: ## Run the desktop app (Electron) in dev mode
	bun run dev:desktop

build: ## Build the whole monorepo
	bun turbo build

build-cli: ## Build only the CLI
	bun run --cwd packages/opencode build

build-desktop: ## Package the desktop app
	bun --cwd packages/desktop package

test: ## Run tests (via turbo; root `bun test` is intentionally disabled)
	bun turbo test

typecheck: ## Type-check the monorepo
	bun turbo typecheck

lint: ## Run the linter (oxlint)
	bun run lint

clean: ## Remove build artifacts and turbo cache
	rm -rf packages/*/dist packages/desktop/out .turbo packages/*/.turbo
