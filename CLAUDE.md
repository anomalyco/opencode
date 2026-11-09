@AGENTS.md

# Ziel dieses Forks: opencode ohne Zugriffe nach außen

Dieser Fork von opencode soll vollständig lokal laufen. Jeder Zugriff auf eine externe Web-Adresse
(Internet) wird entfernt oder auf eine lokale Datenquelle umgebogen – typischerweise eine Konfigurations-
oder Datendatei im Repo bzw. im Benutzer-Config-Verzeichnis, oder einen ausdrücklich konfigurierten
lokalen Endpunkt (`localhost` / `127.0.0.1` / LAN-Adresse aus der Config).

Die Regeln in `AGENTS.md` (Upstream) gelten weiterhin; dieser Abschnitt ergänzt sie für das Fork-Ziel.

## Grundregeln

- **Kein hart codierter externer Host im Laufzeitpfad.** Neue oder geänderte Laufzeit-Codepfade dürfen
  keine Requests an fest eingetragene Internet-Adressen absetzen (`fetch`, HTTP-Clients, `curl` in
  Subprozessen, WebSockets, OAuth-Redirects, Telemetrie, Update-Checks, npm/GitHub-Downloads).
- **Lokal statt remote:** Daten, die bisher geladen wurden (z. B. Modellkatalog, Provider-Listen,
  Plugin-/Skill-Quellen, Themes), kommen aus einer lokalen Datei oder dem gebündelten Snapshot.
  Ein fehlender lokaler Eintrag ist ein klarer Fehler bzw. ein leerer Zustand – **kein** stiller
  Fallback ins Internet.
- **Endpunkte nur aus der Config:** Wo ein Netzwerkzugriff fachlich nötig ist (z. B. LLM-Inferenz),
  kommt die Basis-URL ausschließlich aus der Konfiguration und zeigt auf einen lokalen Dienst
  (z. B. Ollama, LM Studio, vLLM, llama.cpp-Server). Kein Default auf einen Cloud-Host.
- **Fail closed:** Lieber ein Feature deaktivieren oder einen verständlichen Fehler werfen, als
  unbemerkt nach außen zu verbinden.
- **Upstream-freundlich ändern:** Möglichst kleine, gezielte Eingriffe (Default ändern, Flag/Config
  auswerten, Feature abschalten) statt großer Umbauten, damit Merges von `origin/dev` machbar bleiben.
  Jede Fork-spezifische Stelle mit dem Kommentar `// local-only:` kurz begründen, damit sie bei
  Merges auffindbar ist (`grep -rn "local-only:"`).

## Bekannte externe Zugriffe (Ausgangslage, nicht vollständig)

| Bereich | Fundstelle | Hinweis |
| --- | --- | --- |
| Modellkatalog | `packages/core/src/models-dev.ts` (`defaultSource = https://models.opencode.ai`) | Gebündelter Snapshot `packages/core/src/models-dev/snapshot.txt` existiert; `OPENCODE_MODELS_PATH` / `OPENCODE_DISABLE_MODELS_FETCH` werden bereits ausgewertet → lokal als Default machen |
| Auto-Update / Upgrade | `packages/cli/src/services/updater.ts` (opencode.ai, formulae.brew.sh, Install-Script per curl) | `OPENCODE_DISABLE_AUTOUPDATE` existiert → Update-Mechanismus standardmäßig aus |
| Console / Konto | `packages/core/src/console-access.ts` (`https://opencode.ai/console`) | deaktivieren |
| Web-Tools | `packages/core/src/tool/plugin/webfetch.ts`, `websearch.ts` | abschalten oder auf lokale Quellen beschränken |
| Provider-Plugins | `packages/core/src/plugin/provider/*`, `packages/ai/src/providers/*` | Cloud-Defaults (OpenAI, Anthropic, OpenRouter, Bedrock, Vertex, …) entfernen/abschalten; lokale OpenAI-kompatible Endpunkte erhalten |
| OAuth / MCP | `packages/core/src/mcp/oauth.ts`, Copilot-/OpenAI-Auth | Remote-OAuth abschalten; MCP nur lokal (stdio / localhost) |
| Free Models / Upsell / Stats | `OPENCODE_DISABLE_FREE_MODELS`, `packages/tui/src/component/dialog-go-upsell.tsx`, `packages/cli/src/commands/handlers/stats.ts`, `packages/tui/src/util/usage-limits.ts` | entfernen bzw. abschalten |
| Plugins / Pakete zur Laufzeit | npm-Registry, GitHub-Downloads | nur lokal installierte Plugins laden |
| Sharing | Session-Share-Funktionen | deaktivieren |
| ✅ ripgrep | `packages/core/src/ripgrep/binary.ts` (GitHub-Release-Download) | **erledigt:** Download abgeschaltet (`OFFLINE`), fehlendes `rg` ist ein Fehler. `rg` muss im `PATH` liegen; unter Windows `rg.exe` neben `opencode.exe` (`local-only/opencode-offline.cmd`) |
| ✅ TUI-Syntax-Highlighting | `packages/tui/src/parsers-config.ts` (GitHub-URLs) | **erledigt:** Dateien liegen in `packages/tui/assets/tree-sitter/`, geladen über `#tree-sitter-parsers`. Mitgelieferte Sprachen: `packages/tui/script/parsers-languages.json` (übrige ohne Highlighting). Nach Upstream-Änderungen an `parsers-config.ts`: `node packages/tui/script/vendor-parsers.mjs` (Test `test/util/parsers-local.test.ts` erkennt Abweichungen) |

Externe URLs in Tests, Kommentaren, Doku-Links, Schemas (`$schema`) und Fixtures sind unkritisch,
solange sie zur Laufzeit nicht abgerufen werden.

Aktuellen Stand finden:

```sh
grep -rnoE "https?://[a-zA-Z0-9.-]+" packages/*/src --include='*.ts' --include='*.tsx' \
  | grep -vE "localhost|127\.0\.0\.1|\.test\.|/test/" 
```

## Vorgehen bei Änderungen

1. Externen Zugriff identifizieren und klären, ob er zur Laufzeit tatsächlich ausgeführt wird.
2. Lokale Ersatzquelle festlegen (Config-Datei, gebündelter Snapshot, lokaler Endpunkt) oder das
   Feature deaktivieren.
3. Bestehende Env-Flags/Config-Optionen bevorzugt nutzen und deren Default auf „lokal“ setzen,
   statt neue Mechanismen zu erfinden.
4. Test ergänzen, der sicherstellt, dass ohne Netzwerk kein Request nach außen erfolgt bzw. die
   lokale Quelle verwendet wird.
5. Mit `bun run typecheck` und den Tests des betroffenen Pakets prüfen (Tests nicht aus dem Repo-Root
   starten, siehe `AGENTS.md`).

## Verifikation

- Laufzeitverhalten offline prüfen (Netzwerk getrennt bzw. Firewall nur für Loopback offen):
  opencode muss starten, den lokalen Modellkatalog laden und mit einem lokalen LLM-Endpunkt arbeiten.
- Bei Zweifeln ausgehende Verbindungen beobachten (z. B. `lsof -i -P | grep opencode` oder Little
  Snitch/LuLu auf macOS).
