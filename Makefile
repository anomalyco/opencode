# ─────────────────────────────────────────────────────────────────────
# Numeral — project root Makefile
# ─────────────────────────────────────────────────────────────────────
#
# Dev (native)
#   make dev           → backend + frontend (hot reload)
#   make dev-server    → backend only (port 4096)
#   make dev-web       → frontend only (port 5174)
#   make install       → bun install
#   make typecheck     → run turbo typecheck
#   make test-e2e      → run Playwright e2e tests
#
# Dev (Docker — production-like)
#   make up            → build & start prod-like (http://localhost:4096)
#   make dev-up        → start with source mounted (no rebuild on code changes)
#   make down          → stop
#   make logs          → tail logs
#   make rebuild       → force rebuild from scratch
#   make clean         → stop + wipe volumes
#   make shell         → bash into the container
#
# Production (VPS)
#   See deploy/vps-single-customer/
#
# ─────────────────────────────────────────────────────────────────────

# ── Docker (local prod-like) ────────────────────────────────────────

COMPOSE  := docker compose -f docker-compose.local.yml
ENV_FILE := .env.local

$(ENV_FILE):
	@echo "Creating $(ENV_FILE) with defaults…"
	@echo 'OPENCODE_SERVER_PASSWORD=opencode'           >  $(ENV_FILE)
	@echo 'OPENCODE_SERVER_USERNAME=opencode'            >> $(ENV_FILE)
	@echo 'VITE_OPENCODE_LICENSE_URL=https://core.zeroualihamza0206.workers.dev' >> $(ENV_FILE)
	@echo 'CUSTOMER_WORKSPACE=$(HOME)/numeral-workspace' >> $(ENV_FILE)
	@echo "  Edit $(ENV_FILE) to customise"

.PHONY: up dev-up down logs rebuild clean shell \
        dev dev-server dev-web install typecheck test-e2e build

up: $(ENV_FILE)
	@mkdir -p $$(grep CUSTOMER_WORKSPACE $(ENV_FILE) | cut -d= -f2-)
	$(COMPOSE) --env-file $(ENV_FILE) up numeral -d --build
	@echo ""
	@echo "  http://localhost:4096"
	@echo "  login: $$(grep OPENCODE_SERVER_USERNAME $(ENV_FILE) | cut -d= -f2-) / $$(grep OPENCODE_SERVER_PASSWORD $(ENV_FILE) | cut -d= -f2-)"
	@echo ""

# Source-mounted: edit files locally, changes are live (restart container to pick up)
dev-up: $(ENV_FILE)
	@mkdir -p $$(grep CUSTOMER_WORKSPACE $(ENV_FILE) | cut -d= -f2-)
	$(COMPOSE) --env-file $(ENV_FILE) up numeral-dev -d --build
	@echo ""
	@echo "  http://localhost:4096"
	@echo "  Source mounted — edit locally, restart container to pick up changes"
	@echo "  login: $$(grep OPENCODE_SERVER_USERNAME $(ENV_FILE) | cut -d= -f2-) / $$(grep OPENCODE_SERVER_PASSWORD $(ENV_FILE) | cut -d= -f2-)"
	@echo ""

down:
	$(COMPOSE) --env-file $(ENV_FILE) down

logs:
	$(COMPOSE) --env-file $(ENV_FILE) logs -f

rebuild: $(ENV_FILE)
	$(COMPOSE) --env-file $(ENV_FILE) up -d --build --force-recreate

clean:
	$(COMPOSE) --env-file $(ENV_FILE) down -v
	@echo "Volumes removed — next 'make up' starts fresh"

shell:
	$(COMPOSE) --env-file $(ENV_FILE) exec numeral bash

# ── Native dev ──────────────────────────────────────────────────────

install:
	bun install

dev:
	bun run dev

dev-server:
	bun run dev:server

dev-web:
	bun run dev:web

build:
	bun --cwd packages/app build

typecheck:
	bun run typecheck

test-e2e:
	cd packages/app && bunx playwright install && bun run test:e2e:local
