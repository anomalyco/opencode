# Portable ops Makefile for opencode TUI
# Usage:
#   make lint         # gofmt + vet
#   make build        # build CLI to packages/tui/opencode
#   make smoke        # --version + health
#   make ci-local     # lint + smoke
#   make release      # build versioned bin + sha256 (local artifacts/)
#   make clean        # remove local build artifacts

SHELL := /bin/bash
GOFLAGS ?=
GOWORK ?= off
export GOWORK

VERSION ?= 0.4.45
COMMIT  := $(shell git rev-parse --short=12 HEAD)
LDV     := -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT)

PKG_DIR := packages/tui
BIN_DIR := tools/opencode-bin
OUT_BIN := $(BIN_DIR)/opencode-v$(VERSION)

.PHONY: lint build smoke ci-local release clean

lint:
	@cd $(PKG_DIR); \
	out=$$(gofmt -l . || true); \
	if [ -n "$$out" ]; then echo "gofmt issues:"; echo "$$out"; exit 1; fi; \
	go vet ./...

build:
	@mkdir -p $(BIN_DIR)
	@cd $(PKG_DIR); \
	GOFLAGS="$(GOFLAGS)" go mod download; \
	GOFLAGS="$(GOFLAGS)" go build -trimpath -ldflags "$(LDV)" -o ./opencode ./cmd/opencode

smoke: build
	@cd $(PKG_DIR); \
	./opencode --version; \
	./opencode health | sed -n 1,25p

ci-local: lint smoke

release:
	@mkdir -p $(BIN_DIR) artifacts
	@cd $(PKG_DIR); \
	GOFLAGS="$(GOFLAGS)" go mod download; \
	GOFLAGS="$(GOFLAGS)" go build -trimpath -ldflags "$(LDV)" -o ../../$(OUT_BIN) ./cmd/opencode
	@shasum -a 256 $(OUT_BIN) | tee artifacts/opencode-v$(VERSION).sha256 >/dev/null

clean:
	@rm -f $(PKG_DIR)/opencode $(OUT_BIN) artifacts/opencode-v$(VERSION).sha256 2>/dev/null || true
