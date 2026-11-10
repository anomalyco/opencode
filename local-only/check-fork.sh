#!/usr/bin/env bash
# local-only: Prüft nach einem Upstream-Merge/Rebase, ob alle Fork-Änderungen noch vorhanden sind
# (siehe local-only/FORK-CHANGES.md). Aufruf aus dem Repo-Root:  local-only/check-fork.sh [--no-tests]
set -u
cd "$(dirname "$0")/.."
[ -d "$HOME/.bun/bin" ] && PATH="$HOME/.bun/bin:$PATH"

fail=0
check() { # check <beschreibung> <datei> <fester-text>
  if grep -qF -- "$3" "$2" 2>/dev/null; then echo "  OK      $1"
  else echo "  FEHLT   $1  ($2: $3)"; fail=1; fi
}
absent() { # absent <beschreibung> <datei> <fester-text>
  if grep -qF -- "$3" "$2" 2>/dev/null; then echo "  FEHLT   $1  ($2 enthält noch: $3)"; fail=1
  else echo "  OK      $1"; fi
}
exists() { # exists <datei>
  if [ -e "$1" ]; then echo "  OK      $1"; else echo "  FEHLT   $1"; fail=1; fi
}

echo "1. Modellkatalog nur aus lokalem Mirror"
check "fetch nur mit URL"     packages/core/src/models-dev.ts '&& !!options?.url'
check "refresh nur mit URL"   packages/core/src/models-dev.ts 'if (!options?.url) return'

echo "2. ripgrep nie herunterladen"
check "OFFLINE-Konstante"     packages/core/src/ripgrep/binary.ts 'const OFFLINE = true'
check "Fehler statt Download" packages/core/src/ripgrep/binary.ts 'downloads are disabled'

echo "3. Tree-sitter lokal"
check "package.json import"   packages/tui/package.json '"#tree-sitter-parsers"'
check "Session nutzt lokal"   packages/tui/src/routes/session/index.tsx 'from "#tree-sitter-parsers"'
absent "Session ohne GitHub-Config" packages/tui/src/routes/session/index.tsx 'from "../../parsers-config"'
check "Node-Assets"           packages/cli/script/node-assets.ts '@opencode/tui/tree-sitter/'
for f in packages/tui/script/vendor-parsers.mjs packages/tui/script/parsers-languages.json \
  packages/tui/src/parsers-local.bun.ts packages/tui/src/parsers-local.node.ts \
  packages/tui/src/tree-sitter-assets.d.ts packages/tui/assets/tree-sitter/manifest.json \
  packages/tui/test/util/parsers-local.test.ts; do exists "$f"; done
others=$(grep -rlE "from \"[^\"]*parsers-config\"" packages/*/src --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [ -n "$others" ]; then echo "  PRÜFEN  weitere Importe von parsers-config:"; echo "$others" | sed 's/^/            /'; fail=1; fi

echo "4. Websuche fest gesperrt"
exists packages/core/src/config/builtin.ts
check "websearch aus"         packages/core/src/config/builtin.ts '"websearch": false'
check "websearch.use deny"    packages/core/src/config/builtin.ts '{ "action": "websearch.use", "resource": "*", "effect": "deny" }'
check "Config lädt builtin"   packages/core/src/config.ts '...(sources.system ? [builtin] : [])'
check "Test-Filter angepasst" packages/core/test/config/config.test.ts '!(entry instanceof ConfigManaged.Document)'
exists packages/core/test/config/builtin.test.ts

echo "5. Offline-Konfiguration"
for f in local-only/opencode.jsonc local-only/offline.env local-only/opencode-offline.cmd; do exists "$f"; done
for flag in OPENCODE_DISABLE_AUTOUPDATE OPENCODE_DISABLE_FREE_MODELS OPENCODE_DISABLE_MODELS_FETCH OPENCODE_MODELS_URL; do
  if grep -rqF "$flag" packages/*/src 2>/dev/null; then echo "  OK      Flag $flag wird noch ausgewertet"
  else echo "  FEHLT   Flag $flag kommt in packages/*/src nicht mehr vor (umbenannt?)"; fail=1; fi
done

echo
echo "Externe Hosts im Laufzeitcode (mit Tabelle in CLAUDE.md abgleichen):"
grep -rhoE "https?://[a-zA-Z0-9.-]+" packages/*/src --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE "localhost|127\.0\.0\.1" | sort | uniq -c | sort -rn | head -40

if [ "${1:-}" != "--no-tests" ]; then
  echo
  echo "Tests der Fork-Änderungen:"
  (cd packages/core && bun test test/models.test.ts test/ripgrep.test.ts test/config/builtin.test.ts test/config/config.test.ts) || fail=1
  (cd packages/tui && bun test test/util/parsers-local.test.ts test/cli/tui/group-view.test.tsx) || fail=1
fi

echo
if [ "$fail" -eq 0 ]; then echo "Alle Fork-Änderungen vorhanden."; else echo "Es fehlen Fork-Änderungen – siehe local-only/FORK-CHANGES.md."; fi
exit "$fail"
