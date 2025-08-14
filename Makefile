# Minimal ops Makefile for opencode TUI

VERSION ?= 0.4.45
COMMIT  := 
LDV     := -s -w -X main.Version= -X main.Commit=

BIN_DIR := tools/opencode-bin
OUT_BIN := /opencode-v
PKG_DIR := packages/tui

.PHONY: build smoke lint ci-local release release-push clean

build:
	@mkdir -p 
	cd  && go mod download && go build -trimpath -ldflags "" -o ./opencode ./cmd/opencode

smoke: build
	cd  && ./opencode --version && ./opencode health | sed -n 1,25p

lint:
	cd  && out=54023(gofmt -l . || true); if [ -n "54023out" ]; then echo "gofmt issues:"; echo "54023out"; exit 1; fi; go vet ./...

ci-local: lint smoke

release:
	@mkdir -p  artifacts
	cd  && go mod download && go build -trimpath -ldflags "" -o ../../ ./cmd/opencode
	shasum -a 256  | tee artifacts/opencode-v.sha256
	git tag -f v -m "release: v"

release-push: release
	git push --follow-tags || true

clean:
	rm -f /opencode 
