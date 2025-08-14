# Minimal ops Makefile for opencode TUI

VERSION ?= 0.4.45
COMMIT  := 
LDV     := -s -w -X main.Version= -X main.Commit=

.PHONY: build smoke lint ci-local

build:
	cd packages/tui && go mod download && go build -trimpath -ldflags "" -o ./opencode ./cmd/opencode

smoke: build
	cd packages/tui && ./opencode --version && ./opencode health | sed -n 1,25p

lint:
	cd packages/tui && out=50363(gofmt -l . || true); if [ -n "50363out" ]; then echo "gofmt issues:"; echo "50363out"; exit 1; fi; go vet ./...

ci-local: lint smoke
