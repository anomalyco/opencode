# ca Glossary

## Sources

- Guia d'estil de Softcatalà: https://www.softcatala.org/guia-estil-de-softcatala/tota-la-guia/
- Recull de termes de Softcatalà: https://www.softcatala.org/recull/
- TERMCAT (Catalan terminology authority): https://www.termcat.cat/
- Optimot (Generalitat de Catalunya language service): https://optimot.gencat.cat/

Term mappings below were cross-checked against the Catalan translation memories published by
Softcatalà (https://www.softcatala.org/recursos/memories/): KDE (329k segments), GNOME (92k),
LibreOffice (81k), Microsoft Terminology (21k), Chromium (7.7k) and Git (6.6k). Counts cited in
the Notes column are occurrences of the Catalan string for that English source label.

For Git-specific vocabulary (`fork`, `worktree`, `branch`, `commit`), the Git translation memory
is authoritative and overrides the general-purpose corpora.

The general-purpose corpora predate the LLM domain, so AI-specific vocabulary was checked against
shipped AI interfaces instead: Firefox's `browser/browser/genai.ftl` (mozilla-l10n, human-
translated) and Open WebUI's `ca-ES` locale.

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only in commands, package names, paths, or code)
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`, `LSP`, `API`
- Tool identifiers exactly as written: `todowrite`, `bash`, `webfetch`, `doom_loop`, `external_directory`
- Commands, flags, file paths, model IDs, and code literals (keep exactly as written)
- Keyboard legends: `Page Up`, `Page Down`, `Esc`, `Tab`, `Enter`

## Preferred Terms

| English         | Preferred          | Notes                                                                                          |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| shell           | intèrpret d'ordres | GNOME, KDE. Keep `Shell` only where it labels the prompt-mode toggle. Never «closca»/«carcassa» |
| to search       | cercar / cerca     | KDE 3728:21, GNOME 1164:6, MS 124:2 against «buscar»                                             |
| to download     | baixar / baixa     | KDE 639:264, GNOME 120:38 against «descarregar»                                                  |
| next            | següent            | KDE 2552:163, GNOME 545:17, LibreOffice 792:35 against «proper»                                  |
| to toggle       | commuta            | KDE 539:167, GNOME 273:10 against «alterna». Pick one verb and keep it                           |
| called (a tool) | S'ha cridat        | invocation, not naming. KDE uses `cridar`/`invocar`; «Es diu» appears in no corpus               |
| Select All      | Selecciona-ho tot  | unanimous: KDE 25/25, GNOME, LibreOffice, MS, Chromium                                           |
| Close           | Tanca              | KDE 49, LibreOffice 24. Imperative, not «Tancar»                                                 |
| Send            | Envia              | KDE 12, LibreOffice 3, GNOME 2                                                                   |
| Save / Open     | Desa / Obre        | KDE 44 / 33, LibreOffice 19 / 16                                                                 |
| Undo / Redo/Cut | Desfés/Refés/Retalla | KDE 27 / 20 / 16. Never the infinitive                                                         |
| settings        | configuració       | KDE 33, MS 5, GNOME, Chromium. (LibreOffice prefers «Paràmetres» — minority)                     |
| workspace       | espai de treball   | KDE. MS prefers «àrea de treball»; pick one, KDE matches developer tooling better                |
| session         | sessió             | unanimous                                                                                        |
| file / folder   | fitxer / carpeta   | unanimous; not «arxiu»                                                                           |
| tab (UI)        | pestanya           | «Tabulador» is the *key*, not the UI tab                                                         |
| prompt          | indicació          | LLM sense. Open WebUI `ca-ES` 45 occurrences; Firefox `genai.ftl` (human-translated) agrees      |
| agent           | agent              | GNOME «Agent», MS «agent» (7)                                                                    |
| model           | model              | KDE 17, LibreOffice 5, GNOME 2                                                                   |
| token           | token              | keep the English loanword — see note below                                                       |
| to fork         | bifurcar / bifurca | Git ca, 7 of 10 segments                                                                         |
| worktree        | arbre de treball   | Git ca, 59:25; «work tree» is 11/11                                                              |
| diff            | diff (masculine)   | «el diff», «un diff unificat». KDE 243:111; es/fr/de/it in this repo all keep «Diff»              |
| patch (noun)    | pedaç              | Git ca 128:0; Recull de termes «Patch → Pedaç»                                                    |
| tests (software)| proves             | KDE 42, GNOME 15, Git 2, LibreOffice 2; «Unit Tests» → «Proves unitàries». See **Avoid**           |
| to patch        | apedaçar           | Git ca «deixar d'apedaçar», «operació d'apedaçament»; KDE «sense apedaçar». `Patched` → «Apedaçat» |

Notes on the terms the general-purpose corpora did not settle:

- **`prompt` → «indicació»** in the LLM sense. The general corpora only have the command-line
  prompt or request senses («indicador», «petició», «sol·licitud») and the Recull de termes has no
  `prompt` entry at all, so the evidence comes from AI interfaces: Firefox's `genai.ftl` uses
  «indicacions», and Open WebUI's `ca-ES` uses «indicació» 45 times against 4 that keep the English,
  3 «sol·licitud» and 2 «petició». Note `prompt` is also a verb in the source (`Subagent sessions
  cannot be prompted`); rewrite rather than calque — «No es poden enviar indicacions a les sessions
  de subagent».
- **`token` stays English.** The corpora say «testimoni» (KDE 5, GNOME 2, MS 4), but that is the
  authentication-token sense; it is wrong for the tokenizer unit. `AGENTS.md` permits this:
  *"If established practice keeps an English loanword or acronym, keep it rather than inventing a
  translation."*
- **`fork` and `worktree` follow Git**, since both are Git terms and users meet them in `git`
  output first. The 3 non-«bifurcar» `fork` segments are the `--fork-point` flag and the `fork`
  syscall name; the 25 non-translated `worktree` segments are all command literals
  (`git worktree add`, `skip-worktree`). Keep the English inside literal commands, translate the
  prose.
- **`diff` stays English**, unlike `fork` and `worktree`, because Git itself does not settle it:
  excluding command literals, the Git memory is 47 prose «diff» against 46 «diferència». KDE breaks
  the tie at 243:111 in favour of keeping the term, and every sibling locale in this repo already
  does (`Diff unificado`, `Diff unifié`, `Vereinheitlichter Diff`, `Diff unificato`). Treat it as
  masculine and inflect around it: «el diff», «Diff unificat», «Diff dividit», «Vista del diff».
  Where the English says *non-diff lines* rather than *diff*, a paraphrase is fine — «línies sense
  canvis», matching `es` and `it`.
- **`agent` and `model` are spelled the same in Catalan**. Do not let that
  invite word-by-word treatment of the phrases they appear in: `Show agent` and `Cycle agent` are
  verb + noun (see **Avoid**).

## Guidance

- **Verb form depends on who is speaking.** This is the rule most often broken and it is not a
  matter of taste — see Softcatalà, *Formes verbals*:
  - **User → computer** (menu items, buttons, command-palette entries, config toggles): imperative
    **2nd person singular**. `Edita`, `Obre`, `Desa`, `Reinicia`, `Comprova si hi ha actualitzacions`.
  - **Computer → user** (dialogs, status text, questions, descriptions): imperative **2nd person
    plural** (*vós*). `Escriviu…`, `Trieu una carpeta`, `Voleu continuar?`
  - Never use the infinitive as a command. `Tancar` → `Tanca`; `Enviar` → `Envia`; `Desfer` → `Desfés`.
- **Progressive actions use `S'està` / `S'estan` + gerund**, never a bare gerund and never a
  nominalisation. `Downloading` → `S'està baixant` (not «Baixant», not «Baixada»).
- Elide `de` before a vowel: `d'OpenCode`, not «de OpenCode».
- Sentence case only. Do not carry English title case into Catalan (`Última activitat`, not
  «Última Activitat»).
- Drop `please` and `sorry` entirely; Catalan software copy does not render them.
- Prefer `ser` over `estar` with adjectives and for location (`El disc és ple`).
- **`web` takes the gender of the elided noun** (TERMCAT): «un web» is *un lloc web*, «una web» is
  *una pàgina web*. It is not a free choice. Every article-bearing `web` string in this codebase
  refers to the Web as a whole or to publishing a session on it — never to a single page — so all
  of them are **masculine**: `al web`, `el web`. Softcatalà's Recull de termes (revised by TERMCAT)
  has «Mapa del web»; Microsoft Terminology (56:0), Chromium (13:0) and LibreOffice agree for
  «on the web». KDE and GNOME often use the feminine, but that reflects common parlance rather
  than the rule. Attributive uses take no article and raise no question: `Cerca web`.
- Prefer active voice; English passives usually become pronominal (`s'ha desat`).
- Omit possessives unless ownership is genuinely ambiguous (`el fitxer`, not «el vostre fitxer»).
- Use gender-neutral constructions where they exist (`Us donem la benvinguda`, `Tothom`).

## Avoid

- Avoid translating a word whose English part of speech you have not resolved. `Show agent` is
  verb + noun, not «Agent d'espectacles»; `Cycle agent` is verb + noun, not «Agent de cicle».
- Avoid rendering one source term several ways. `shell` currently appears as `Shell`, `shell`,
  `intèrpret d'ordres`, `Carcassa` and `closca` across the locale.
- Avoid collapsing distinct states into one string. `Resetting workspace` and `Workspace reset`
  must not both become «Restabliment de l'espai de treball».
- Avoid mixing *tu* and *vós* within a surface once the speaker direction is fixed.
- Avoid «tests» for software *tests*; use «proves». The corpora are unanimous on this
  (KDE 42, GNOME 15, Git 2, LibreOffice 2), including «Unit Tests» → «Proves unitàries».
- Avoid merging `workspace` («espai de treball») and `worktree` («arbre de treball»). The English
  source uses both, occasionally in one string (`Runs after creating a new workspace (worktree)`).
  Keep whatever distinction the English makes.
