# Fork-Änderungen (local-only) – Protokoll für Release-Wechsel

Dieses Dokument listet **jede** Abweichung dieses Forks von Upstream (`origin/dev`) so, dass sie nach einem
Wechsel auf ein neues Upstream-Release erneut umgesetzt werden kann – per Merge/Rebase oder notfalls von Hand.

- Ziel und Regeln des Forks: [`CLAUDE.md`](../CLAUDE.md)
- Automatische Prüfung nach dem Wechsel: [`local-only/check-fork.sh`](check-fork.sh)
- Alle Code-Stellen tragen den Kommentar `local-only:` → `grep -rn "local-only:" packages local-only`

**Pflege:** Wer eine neue Fork-Änderung einbaut, ergänzt hier einen Abschnitt (gleiches Schema) und in
`check-fork.sh` eine Prüfung.

Letzte Upstream-Basis: `d4d8567da8` (2026-11-09, „fix(tui): give the shell output dialog new-design footer
actions (#62932)“). Nach jedem Release-Wechsel hier aktualisieren.

---

## Vorgehen beim Release-Wechsel

```sh
git fetch origin
git switch -c local-<release> <fork-branch>      # Arbeitskopie, alter Stand bleibt erhalten
git rebase origin/dev                             # oder: git merge origin/dev
#   Konflikte anhand der Abschnitte unten lösen (Abschnitt "Konflikt-Hinweise")
bun install
local-only/check-fork.sh                          # Marker + Verhalten + Restliste externer Hosts
```

Empfehlung: **Rebase**, weil die Fork-Änderungen dann als kleine, nachvollziehbare Commits oben auf Upstream
liegen. Ein Commit pro Bereich (siehe Abschnitte unten) – Konflikte bleiben so lokal.

Falls ein Rebase zu aufwendig wird, Änderungen auf frischem Upstream neu aufsetzen:

```sh
git switch -c local-<release> origin/dev
git checkout <alter-fork-branch> -- local-only CLAUDE.md packages/tui/assets/tree-sitter \
  packages/tui/script/vendor-parsers.mjs packages/tui/script/parsers-languages.json \
  packages/tui/src/parsers-local.node.ts packages/tui/src/tree-sitter-assets.d.ts \
  packages/tui/test/util/parsers-local.test.ts
node packages/tui/script/vendor-parsers.mjs       # Grammatiken passend zur neuen parsers-config.ts (braucht Netz)
# danach die Code-Eingriffe aus den Abschnitten 1–4 von Hand einbauen
```

Nach dem Wechsel zusätzlich die **Restliste externer Zugriffe** neu erzeugen (`check-fork.sh` gibt sie aus) und
mit der Tabelle in `CLAUDE.md` abgleichen: Upstream kann neue Internet-Zugriffe hinzufügen.

---

## 1. Modellkatalog nur aus lokalem Mirror

**Zweck:** opencode lädt den Modellkatalog nie von `https://models.opencode.ai`. Abruf/Refresh nur, wenn
`OPENCODE_MODELS_URL` (lokaler Mirror) gesetzt ist; sonst gebündelter Snapshot bzw. `OPENCODE_MODELS_PATH`.
Gilt auch für Prozesse ohne Offline-Env-Variablen (z. B. Hintergrund-Server).

**Commit:** `8eb3d92aed fix(core): never fetch models catalog without configured mirror`

**Datei:** `packages/core/src/models-dev.ts`, Funktion `layer` (Service `ModelsDev`)

```ts
// vorher
const fetch = options?.fetch ?? true
// nachher
// local-only: only fetch from an explicitly configured mirror (OPENCODE_MODELS_URL), never
// from models.opencode.ai, so a process started without the offline env vars stays offline.
const fetch = (options?.fetch ?? true) && !!options?.url
```

und am Anfang von `refresh`:

```ts
const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
  // local-only: without a configured mirror there is nothing to refresh from.
  if (!options?.url) return
```

**Tests:** `packages/core/test/models.test.ts`
- Konstante `const mirror = "https://models.opencode.ai"` (Mock-Host) und `url: mirror` in `buildLayer`-Default
  sowie in allen Tests mit `fetch: true`.
- Upstream-Test „uses the default models URL when the configured URL is empty“ ersetzt durch
  „never fetches or refreshes without a configured URL“ (erwartet `[]` und keine HTTP-Calls).

**Konflikt-Hinweise:** Wenn Upstream `layer`/`refresh` umbaut, Ziel neu umsetzen: *jede* Stelle, die
`defaultSource` als Abrufziel nutzt, nur ausführen, wenn `options.url` gesetzt ist. Neue Tests von Upstream mit
`fetch: true` brauchen `url: mirror`.

**Prüfen:** `cd packages/core && bun test test/models.test.ts`

---

## 2. ripgrep nie herunterladen

**Zweck:** Kein Download von GitHub-Releases. Fehlt `rg`, gibt es einen klaren Fehler. `rg` muss im `PATH` liegen
(Windows: `rg.exe` neben `opencode.exe`, siehe `opencode-offline.cmd`).

**Commit:** `cfcc008606 feat(core): disable ripgrep download …`

**Datei:** `packages/core/src/ripgrep/binary.ts`

Im `namespace RipgrepBinary` oben:

```ts
// local-only: the download path below stays for upstream merges but is never taken.
const OFFLINE = true
```

Direkt nach der Prüfung `if (yield* fs.isFile(target)...) return target` und **vor** der Platform-/Download-Logik:

```ts
// local-only: never download ripgrep from GitHub; it must be installed on PATH or placed at `target`.
if (OFFLINE)
  return yield* Effect.fail(
    new Error(`ripgrep not found: put the rg executable on PATH or at ${target} (downloads are disabled)`),
  )
```

**Tests:** `packages/core/test/ripgrep.test.ts` – Block `describe("RipgrepBinary offline", …)` am Dateiende
(+ Import `withEnv` aus `./fixture/env`).

**Konflikt-Hinweise:** Der Upstream-Download-Code bleibt absichtlich stehen (kleiner Diff). Wenn Upstream die
Datei umbaut: den Fehler-Return an die Stelle setzen, an der der Download beginnt. Test prüft auf den Text
„downloads are disabled“.

**Prüfen:** `cd packages/core && bun test test/ripgrep.test.ts`

---

## 3. TUI-Syntax-Highlighting aus lokalen Dateien

**Zweck:** Tree-sitter-Grammatiken (`.wasm`) und Queries (`.scm`) liegen im Repo, statt zur Laufzeit von GitHub
geladen zu werden. Nur die Sprachen aus `parsers-languages.json` werden mitgeliefert (TypeScript, JavaScript,
Markdown bringt opentui selbst mit).

**Commit:** `39430c5048 feat(tui): bundle tree-sitter grammars locally`

**Neue Dateien (übernehmen, konfliktfrei):**

| Datei | Inhalt |
| --- | --- |
| `packages/tui/script/vendor-parsers.mjs` | Download-Skript (nur Entwicklungszeit, braucht Netz) |
| `packages/tui/script/parsers-languages.json` | Liste der mitgelieferten Sprachen |
| `packages/tui/assets/tree-sitter/**` | heruntergeladene Dateien + `manifest.json`, `sources.json` (generiert) |
| `packages/tui/src/parsers-local.bun.ts` | generiert: statische `with { type: "file" }`-Imports |
| `packages/tui/src/parsers-local.node.ts` | Node-Variante, liest `manifest.json` |
| `packages/tui/src/tree-sitter-assets.d.ts` | Typen für `*.wasm` / `*.scm` |
| `packages/tui/test/util/parsers-local.test.ts` | keine URLs, Dateien vorhanden, passt zu `parsers-config.ts` |

**Eingriffe in Upstream-Dateien:**

`packages/tui/package.json` → unter `"imports"` (neben `#string-width`):

```json
"#tree-sitter-parsers": {
  "bun": "./src/parsers-local.bun.ts",
  "node": "./src/parsers-local.node.ts",
  "default": "./src/parsers-local.bun.ts"
},
```

`packages/tui/src/routes/session/index.tsx`:

```ts
// vorher
import parsers from "../../parsers-config"
addDefaultParsers(parsers.parsers)
// nachher
// local-only: lokal mitgelieferte Grammatiken statt der GitHub-URLs aus parsers-config.ts (script/vendor-parsers.mjs)
import { parsers } from "#tree-sitter-parsers"
addDefaultParsers(parsers)
```

`packages/tui/test/cli/tui/group-view.test.tsx`: gleicher Austausch (Import + `addDefaultParsers(parsers)`).

`packages/cli/script/node-assets.ts`:

```ts
const treeSitterRoot = path.resolve(dir, "../tui/assets/tree-sitter")   // neben `const dir = …`
// in collectNodeAssets(), Liste der Assets:
// local-only: lokal mitgelieferte Tree-sitter-Grammatiken (packages/tui/src/parsers-local.node.ts)
...(await collectFiles(treeSitterRoot))
  .filter((relative) => !relative.endsWith(".json"))
  .map((relative) => ({
    key: `@opencode/tui/tree-sitter/${relative.replaceAll(path.sep, "/")}`,
    source: path.join(treeSitterRoot, relative),
  })),
```

**Nach jedem Release-Wechsel:**
1. Prüfen, ob Upstream `parsers-config.ts` geändert hat: `git diff <alte-basis> origin/dev -- packages/tui/src/parsers-config.ts`
2. Falls ja (oder Test „entspricht parsers-config.ts“ schlägt fehl): `node packages/tui/script/vendor-parsers.mjs`
   ausführen (einmalig mit Netz), Ergebnis committen.
3. Weitere Stellen suchen, die `parsers-config` importieren:
   `grep -rnE 'from "[^"]*parsers-config"' packages/*/src --include='*.ts' --include='*.tsx'`
   – jede neue Laufzeit-Verwendung auf `#tree-sitter-parsers` umstellen.

**Prüfen:** `cd packages/tui && bun test test/util/parsers-local.test.ts test/cli/tui/group-view.test.tsx`

---

## 4. Websuche fest einkompiliert gesperrt

**Zweck:** Die Websuche (`websearch`-Tool, Server-Aktion `websearch.query`) ist im Programm selbst gesperrt, nicht
nur per Config. Grund: Suchanfragen des Modells können Code aus der Session an einen externen Dienst schicken. Der
Anwender kann die Sperre weder in seiner Config noch per `OPENCODE_CONFIG_CONTENT` noch über die System-Config
aufheben. webfetch bleibt bewusst per Config geregelt (Abschnitt 5).

**Neue Datei:** `packages/core/src/config/builtin.ts` – die einkompilierte Config als JSONC-Text:

```jsonc
{
  "websearch": false,
  "policies": [{ "action": "websearch.use", "resource": "*", "effect": "deny" }]
}
```

`websearch: false` nimmt dem Modell das Tool weg; die Policy entfernt zusätzlich alle Suchanbieter
(`packages/core/src/config/plugin/policy.ts`), sodass auch eine direkte Server-Anfrage ins Leere läuft.

**Eingriff:** `packages/core/src/config.ts`
- Import `ConfigBuiltin` neben `ConfigManaged`.
- Vor `const loadFile`: Text mit `parseInfo` lesen, bei Fehler `Effect.die` (fail closed), daraus
  `const builtin = new Document(...)`.
- In `load` als letzter Eintrag der Liste `managed` (nach Systemverzeichnis und MDM-plist):
  `...(sources.system ? [builtin] : [])`. Dadurch gilt die Rangfolge der verwalteten Config: Einstellungen werden
  zuletzt geladen, Policies zuerst geprüft – beides hat Vorrang vor allen anderen Quellen.
- Übersprungen wird die eingebaute Config nur mit der Test-Option `system: false` (in Produktion nie gesetzt), damit
  Upstream-Tests unabhängig von den Fork-Sperren bleiben.

**Tests:**
- Neu: `packages/core/test/config/builtin.test.ts` (Benutzer-, Projekt-, System- und Content-Config schalten die
  Websuche ein und erlauben sie → Ergebnis bleibt `false`/`deny`; ohne Systemverzeichnis ebenso).
- Angepasst: `packages/core/test/config/config.test.ts`, Test „keeps only the policies of documents from
  integrations managed policy denies“ – der Hilfsfilter `supplied` schließt `ConfigManaged.Document` aus
  (+ Import `ConfigManaged`), weil die eingebaute Config wie Integrations-Dokumente keinen Pfad hat.

**Sperre aufheben (falls nötig):** Text in `builtin.ts` auf `{}` setzen oder die betreffenden Zeilen entfernen und
neu bauen. `config.ts` bleibt unverändert. Bewusst gibt es keinen Laufzeit-Schalter (Env-Variable o. Ä.).

**Konflikt-Hinweise:** Wenn Upstream die Ladereihenfolge in `load` umbaut, die eingebaute Config wieder hinter allen
verwalteten Quellen einhängen (Einstellungen: zuletzt geladen; Policies: zuerst geprüft). Neue Upstream-Tests, die
mit einem System-Verzeichnis alle Dokumente aufzählen, sehen zwei zusätzliche Einträge ohne Pfad.

**Prüfen:** `cd packages/core && bun test test/config/builtin.test.ts test/config/config.test.ts`

---

## 5. Offline-Konfiguration und Startskripte (nur `local-only/`, konfliktfrei)

| Datei | Zweck |
| --- | --- |
| `local-only/README.md` | Überblick über den Fork für Anwender und Betrieb (Einrichtung, Grenzen). Bei neuen Fork-Änderungen mitpflegen |
| `local-only/opencode.jsonc` | Config, die per Config abschaltbare Zugriffe sperrt: `update: disable`, `share: disabled`, `formatter: false`, webfetch-Deny (Loopback erlaubt), festes Standardmodell, Provider-Vorlage `firma` (OpenAI-kompatibel, lokale Basis-URL, Hinweis zu `reasoning_effort`) |
| `local-only/offline.env` | Env-Variablen für macOS/Linux: `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_FREE_MODELS` |
| `local-only/opencode-offline.cmd` | Windows-Starter: gleiche Variablen, `rg.exe` neben `opencode.exe` im `PATH` |

**Nach jedem Release-Wechsel:** prüfen, ob die verwendeten Config-Schlüssel und Env-Flags noch existieren
(Upstream benennt gelegentlich um):

```sh
grep -rn "OPENCODE_DISABLE_AUTOUPDATE\|OPENCODE_DISABLE_FREE_MODELS\|OPENCODE_DISABLE_MODELS_FETCH\|OPENCODE_MODELS_URL\|OPENCODE_MODELS_PATH" packages/*/src | head
```

Config-Schlüssel (`update`, `share`, `formatter`, `permissions`, `policies`; `websearch` siehe Abschnitt 4) im Schema unter
`packages/schema/src/config/` gegenüberprüfen.

---

## 6. Projektdokumentation

- `CLAUDE.md`: Fork-Ziel, Regeln, Tabelle der bekannten externen Zugriffe (✅ = erledigt).
- `local-only/FORK-CHANGES.md` (diese Datei), `local-only/check-fork.sh`.

Konflikte in `CLAUDE.md` sind unwahrscheinlich (Upstream nutzt `AGENTS.md`); die erste Zeile `@AGENTS.md` muss
erhalten bleiben.

---

## Offene Punkte (noch nicht umgesetzt)

Siehe Tabelle in `CLAUDE.md` – Einträge ohne ✅: Auto-Update-Code, Console/Konto, webfetch im Code,
Cloud-Provider-Plugins, OAuth/MCP, Free Models/Upsell/Stats, Plugin-Downloads, Sharing. Diese sind derzeit nur
über Config/Env abgeschaltet (Abschnitt 5), nicht im Code. Die Websuche ist seit Abschnitt 4 im Code gesperrt.
