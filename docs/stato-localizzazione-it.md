# Stato Localizzazione Italiana

Data aggiornamento: 7 aprile 2026

## Obiettivo
Abilitare e preparare la localizzazione italiana nel progetto OpenCode.

## Completato
- Aggiunta lingua `it` nel sistema locale dell'app.
- Aggiornato rilevamento automatico lingua italiana.
- Creati e popolati i dizionari italiani:
  - `packages/app/src/i18n/it.ts`
  - `packages/ui/src/i18n/it.ts`
- Aggiornato test di parità i18n per includere `it`.
- Aggiunto glossario italiano in `.opencode/glossary/it.md`.
- Rifinitura lessicale della UI italiana (terminologia più naturale e coerente).

## Verifiche eseguite
- `bun test parity.test.ts` in `packages/app/src/i18n`: OK.
- `bun typecheck` in `packages/app`: OK.
- `bun typecheck` in `packages/ui`: OK.
- Verifica post-rifinitura lessicale: OK su test e typecheck.

## Note tecniche Windows
- I file `custom-elements.d.ts` in alcuni package sono stati sistemati con riferimento TypeScript esplicito per evitare problemi dei symlink su Windows.

## Prossimi passi consigliati
- Rifinire lessico e tono dell'italiano con revisione manuale UX.
- Verificare in esecuzione reale schermate principali e notifiche.
- Allineare eventuali pagine docs web italiane mancanti in `packages/web/src/content/docs/it/`.
