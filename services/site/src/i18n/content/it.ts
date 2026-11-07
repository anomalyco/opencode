import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessioni, schede, diff, browser integrato ed estensioni su macOS, Windows e Linux.",
      action: "Scarica",
    },
    mobile: {
      name: "Mobile",
      body: "Avvia, guida e approva le sessioni dal telefono, ovunque tu sia.",
      action: "Scarica",
    },
    terminal: {
      name: "Terminal",
      body: "Un'interfaccia da terminale veloce che funziona in qualsiasi shell, editor o server remoto.",
      action: "Installa",
    },
    sdk: {
      body: "Controlla OpenCode dai tuoi script, job di CI e strumenti.",
      action: "Leggi i docs",
    },
    ide: {
      name: "Estensioni IDE",
      body: "Apri OpenCode in VS Code, Cursor e Windsurf, oppure in Zed e negli IDE JetBrains tramite ACP.",
      action: "Installa",
    },
    mini: {
      body: "Un'interfaccia da terminale minimale. Le risposte finiscono nello scrollback, con un solo prompt sotto.",
      action: "Installa",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App desktop per macOS, Windows e Linux",
      description:
        "Esegui in parallelo tutti gli agenti OpenCode che vuoi, guarda ogni modifica in un browser accanto e riprendili su qualsiasi dispositivo. Per macOS, Windows e Linux.",
      intro:
        "Esegui più agenti insieme, ogni sessione nella sua scheda. Rivedi ogni modifica come diff, commenta qualsiasi riga e controlla il risultato nel browser integrato. Per macOS, Windows e Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agenti in parallelo",
          body: "Avvia tutti gli agenti che vuoi e lasciali lavorare in parallelo. Passa dall'uno all'altro man mano che finiscono.",
        },
        "see-it-in-the-browser": {
          title: "Guardalo nel browser",
          body: "La tua app si apre in un browser accanto all'agente, così entrambi vedete ogni modifica appena arriva.",
        },
        "on-every-device": {
          title: "Su ogni dispositivo",
          body: "Avvia agenti su tutti i tuoi dispositivi e riprendili dall'app desktop, dal terminale o dal telefono.",
        },
        "extend-it": {
          title: "Estendilo",
          body: "Collega i tuoi strumenti e servizi così l'agente può lavorare con qualsiasi cosa. Oppure fai creare a OpenCode plugin per sé stesso, con la loro interfaccia nella barra laterale.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, le tue sessioni di coding sul telefono",
      description:
        "Avvia e guida sessioni OpenCode dal telefono. Parla con l'agente mentre gira sul tuo computer.",
      intro:
        "Avvia e guida sessioni dal telefono, ovunque tu sia. Chiama una sessione e parla con l'agente, oppure apri una sessione per riprendere da dove eri rimasto, tutto con OpenCode sul tuo computer.",
      features: {
        "notify-when-done": {
          title: "Avviso a fine lavoro",
          body: "Ricevi un breve riepilogo quando una sessione che hai avviato termina.",
        },
        "pair-from-anywhere": {
          title: "Abbina da ovunque",
          body: "Collegati da qualsiasi rete con opencode pair --remote.",
        },
        "every-computer": {
          title: "Ogni computer",
          body: "Passa da un computer abbinato all'altro con un tocco.",
        },
        "siri-and-shortcuts": {
          title: "Siri e Comandi",
          body: "Avvia una chiamata o una sessione da Siri o dal Centro di Controllo.",
        },
        "follow-along": {
          title: "Segui in diretta",
          body: "Guarda la timeline aggiornarsi mentre l'agente lavora.",
        },
        "your-computer": {
          title: "Il tuo computer",
          body: "Si collega a OpenCode in esecuzione sulla tua macchina.",
        },
        "share-sheet": {
          title: "Condivisione",
          body: "Condividi qualsiasi cosa con una sessione senza aprire l'app.",
        },
        "mute-sessions": {
          title: "Sessioni mute",
          body: "Tieni una sessione nella lista senza riceverne le notifiche.",
        },
      },
      showcase: {
        voice: {
          title: "Voce",
          body: "Chiama una sessione e di' cosa ti serve. L'agente risponde a voce.",
        },
        sessions: {
          title: "Sessioni",
          body: "Apri qualsiasi sessione per vedere a che punto è, poi riprendi da dove avevi lasciato.",
        },
        steer: {
          title: "Guida",
          body: "Invia un messaggio per cambiare direzione a metà sessione.",
        },
        results: {
          title: "Risultati",
          body: "La chiamata ti dice cosa è cambiato quando il lavoro richiesto è finito.",
        },
      },
    },
    terminal: {
      title: "OpenCode | UI da terminale per l'agente di coding open source",
      description:
        "Un'interfaccia da terminale veloce per OpenCode che funziona in qualsiasi shell, editor o server remoto. Descrivi cosa vuoi, vedi ogni modifica come diff e approva i comandi.",
      intro:
        "Un'interfaccia da terminale veloce che funziona in qualsiasi shell, editor o server remoto. Descrivi cosa vuoi a parole tue, guarda ogni modifica arrivare come diff e scegli quali comandi partono da soli.",
      features: {
        "any-terminal": {
          title: "Ogni terminale",
          body: "Funziona in qualsiasi shell, nel terminale del tuo editor o su un server remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diff nella timeline",
          body: "Vedi ogni modifica come diff nella timeline, mentre l'agente la fa.",
        },
        "pick-up-later": {
          title: "Riprendi dopo",
          body: "Continua l'ultima sessione con -c, o una qualsiasi con -s.",
        },
        "one-off-runs": {
          title: "Run singoli",
          body: "opencode run invia un messaggio e stampa la risposta.",
        },
        "agents-and-commands": {
          title: "Agenti e comandi",
          body: "Cambia agente con shift+tab e apri tutti i comandi con ctrl+p.",
        },
        "auto-approve": {
          title: "Auto-approva",
          body: "Avvia con --auto per consentire ogni azione che non hai negato.",
        },
        "any-server": {
          title: "Ogni server",
          body: "Collegati a un server OpenCode tramite URL con --server.",
        },
        "usage-stats": {
          title: "Statistiche",
          body: "opencode stats mostra statistiche d'uso da condividere.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Chiedi a parole tue",
          body: "Scrivi cosa vuoi, e l'agente mostra il suo piano mentre lavora.",
        },
        "approve-what-runs": {
          title: "Approva i comandi",
          body: "Le modifiche appaiono come diff e i comandi aspettano il tuo permesso.",
        },
        "make-it-yours": {
          title: "Fallo tuo",
          body: "Cambia tema con un tasto, da quello predefinito a tokyonight e altri.",
        },
        mini: {
          title: "Mini",
          body: "Esegui opencode mini e le risposte finiscono nel tuo scrollback.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript per script, job di CI e strumenti",
      description:
        "Controlla OpenCode dai tuoi script, job di CI e strumenti. Il client TypeScript tipizzato crea sessioni, invia prompt e trasmette ogni evento in tempo reale.",
      intro:
        "Controlla OpenCode dai tuoi script, job di CI e strumenti. L'SDK esegue OpenCode nel tuo processo, con la tua configurazione e i tuoi modelli, e il suo client tipizzato crea sessioni, invia prompt e trasmette ogni evento.",
      features: {
        "typescript-client": {
          title: "Client TypeScript",
          body: "Richieste ed eventi tipizzati, con gli stessi valori di @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessioni da codice",
          body: "Crea sessioni e invia prompt da qualsiasi script.",
        },
        "any-model": {
          title: "Ogni modello",
          body: "Usa i modelli configurati nel tuo OpenCode.",
        },
        "npm-or-bun": {
          title: "npm o bun",
          body: "Installalo con npm i @opencode/sdk o bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host in-process",
          body: "Esegue OpenCode in memoria, senza passare dalla rete.",
        },
        "your-plugins": {
          title: "I tuoi plugin",
          body: "Passa i tuoi plugin quando crei l'host in-process.",
        },
        "promise-or-effect": {
          title: "Promise o Effect",
          body: "Un'API Promise e un'API Effect con gli stessi valori.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Esegui OpenCode in un Durable Object di Cloudflare su Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Ripara la CI da codice",
          body: "Un breve script chiede a OpenCode di correggere i test falliti, poi li riesegue.",
        },
        "follow-every-step": {
          title: "Segui ogni passo",
          body: "Trasmetti gli eventi e vedi ogni strumento chiamato dall'agente.",
        },
        "build-your-own-tools": {
          title: "Crea i tuoi strumenti",
          body: "Integra OpenCode in bot, dashboard e workflow con poche righe.",
        },
        "in-your-process": {
          title: "Nel tuo processo",
          body: "Esegue OpenCode nel tuo processo, con la tua config e i tuoi modelli.",
        },
      },
    },
    ide: {
      title: "OpenCode | Integrazioni editor per VS Code, Cursor e Zed",
      description:
        "Usa OpenCode nel tuo editor, con l'estensione per VS Code, Cursor, Windsurf e VSCodium, e opencode acp per Zed, gli IDE JetBrains e altri editor ACP.",
      intro:
        "Usa OpenCode nel tuo editor. In VS Code, Cursor, Windsurf e VSCodium, esegui opencode nel terminale integrato e l'estensione si installa da sola. Zed, gli IDE JetBrains e gli altri editor che supportano l'Agent Client Protocol eseguono OpenCode con opencode acp.",
      features: {
        "quick-launch": {
          title: "Avvio rapido",
          body: "Cmd+Esc o Ctrl+Esc apre OpenCode in un terminale diviso.",
        },
        "new-session": {
          title: "Nuova sessione",
          body: "Cmd+Shift+Esc o Ctrl+Shift+Esc avvia un'altra sessione.",
        },
        context: {
          title: "Contesto",
          body: "Condivide con OpenCode la selezione o la scheda corrente.",
        },
        "file-references": {
          title: "Riferimenti ai file",
          body: "Cmd+Option+K o Alt+Ctrl+K inserisce @File#L37-42.",
        },
        "installs-itself": {
          title: "Si installa da sé",
          body: "Esegui opencode nel terminale integrato per aggiungerla.",
        },
        "acp-editors": {
          title: "Editor ACP",
          body: "Zed, IDE JetBrains, Avante.nvim e CodeCompanion.nvim.",
        },
        "open-vsx": {
          title: "Open VSX",
          body: "Anche su Open VSX per Cursor, Windsurf e VSCodium.",
        },
        "same-agent": {
          title: "Stesso agente",
          body: "L'OpenCode che usi nel terminale, accanto al tuo codice.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, un'interfaccia da terminale minimale",
      description:
        "Mini esegue OpenCode in un'interfaccia da terminale minimale. Le risposte finiscono nello scrollback del terminale, e in basso restano solo un prompt e una riga di stato.",
      intro:
        "Un'interfaccia da terminale minimale per OpenCode. Esegui opencode mini e le risposte finiscono direttamente nello scrollback del tuo terminale, così puoi scorrerle, cercarle e copiarle come qualsiasi altro output. In basso restano solo il prompt e una riga di stato.",
      features: {
        "your-scrollback": {
          title: "Il tuo scrollback",
          body: "Le risposte diventano normale cronologia del terminale.",
        },
        "one-prompt": {
          title: "Un solo prompt",
          body: "Agente, modello, contesto e costo su una riga di stato.",
        },
        permissions: {
          title: "Permessi",
          body: "Consenti modifiche e comandi dall'area del prompt.",
        },
        "how-much-shows": {
          title: "Quanto mostrare",
          body: "Silenzioso, predefinito o tutto, per ragionamento e output degli strumenti.",
        },
        "pick-up-later": {
          title: "Riprendi dopo",
          body: "Continua l'ultima sessione con -c, o una qualsiasi con -s.",
        },
        "same-opencode": {
          title: "Stesso OpenCode",
          body: "Lo stesso server, gli stessi agenti e modelli delle altre app.",
        },
        agents: {
          title: "Agenti",
          body: "Cambia agente direttamente dal prompt.",
        },
        compact: {
          title: "Compatta",
          body: "Riduci una sessione lunga con /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Estensioni",
    body: "Usa OpenCode in VS Code, oppure in Zed e altri editor tramite ACP.",
    action: "Installa",
  },
  extensions: {
    browse: {
      body: "Fai usare agli agenti il tuo vero browser.",
      title: "OpenCode | Browse, il tuo vero browser per agenti di coding",
      description:
        "Browse permette a OpenCode e ad altri client MCP di usare il tuo vero browser. Gli agenti guidano schede in background con Playwright e ti ripassano login e 2FA.",
      intro:
        "Un server MCP e un'estensione Chromium che permettono ai tuoi agenti di usare il tuo vero browser, con le tue schede, i tuoi login e le tue estensioni. Aprono e guidano le schede con Playwright, fanno screenshot e registrano lo schermo, in schede in background raggruppate e fuori dai piedi. Quando tocca a te, per un login, una richiesta 2FA o un pagamento, ti ripassano la scheda e continuano appena fai clic su Continua.",
      features: {
        "your-real-browser": {
          title: "Il tuo vero browser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera e Chromium.",
        },
        "out-of-your-way": {
          title: "Fuori dai piedi",
          body: "Le schede degli agenti si aprono in background, in gruppi compressi.",
        },
        handoffs: {
          title: "Passaggi",
          body: "Fai tu il login o il passaggio 2FA, poi fai clic su Continua.",
        },
        "lend-a-tab": {
          title: "Presta schede",
          body: "Fai clic sul pulsante nella barra per affidare a un agente una scheda aperta.",
        },
        "record-and-capture": {
          title: "Registra e cattura",
          body: "Screenshot, registrazioni dello schermo e traffico di rete in formato HAR.",
        },
        "any-mcp-client": {
          title: "Ogni client MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed e molti altri.",
        },
        "all-your-logins": {
          title: "Tutti i tuoi accessi",
          body: "Gli agenti usano i siti a cui hai già effettuato l'accesso. Niente chiavi, niente configurazione.",
        },
        allowlists: {
          title: "Allowlist",
          body: "Limita le schede di una sessione ai siti che indichi.",
        },
      },
      install:
        "Installa prima l'estensione di Chrome. Ti guida nel resto dei passaggi. Per installare la CLI direttamente, usa uno di questi.",
    },
  },
  apps: {
    browse: {
      category: "Controllo del browser per agenti",
      body: "Lascia che il tuo agente usi il tuo vero browser, con i tuoi accessi e le tue schede.",
    },
    opentunnel: {
      category: "Tunnel locali",
      body: "URL HTTPS pubblici per le app locali.",
    },
    opentui: {
      category: "Libreria",
      body: "Una libreria per interfacce utente da terminale.",
    },
    hex: {
      category: "Dettatura vocale",
      body: "Dettatura vocale sul dispositivo per qualsiasi app.",
    },
  },
  getStarted: {
    title: "Inizia",
    lead: "Il modo più semplice per iniziare è scaricare OpenCode e usare i modelli gratuiti. Nessun account necessario. Per avere di più, usa il tuo abbonamento oppure OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "scaricare OpenCode",
      },
      "free-models": {
        text: "modelli gratuiti",
      },
      "your-own-subscription": {
        text: "il tuo abbonamento",
      },
      "a-subscription-you-already-have": {
        text: "un abbonamento che hai già",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
    },
    steps: {
      download: {
        title: "Scarica",
        line: "Desktop, terminale o mobile.",
      },
      "use-free-models": {
        title: "Modelli gratuiti",
        line: "OpenCode include una serie di modelli gratuiti. Nessun account necessario.",
      },
      "add-more-models": {
        title: "Altri modelli",
        line: "Usa il tuo abbonamento oppure i modelli selezionati di OpenCode Go da 10 $/mese.",
      },
    },
    sentence:
      "Scarica OpenCode, inizia con i modelli gratuiti e aggiungi il tuo abbonamento o OpenCode Go quando vuoi di più.",
  },
  byos: {
    title: "Porta il tuo abbonamento",
    headline: "Usa gli abbonamenti che hai già.",
    line: "Accedi con ChatGPT Plus o Pro oppure con GitHub Copilot. Oppure usa un abbonamento OpenCode.",
    yours: {
      label: "Il tuo abbonamento",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
      },
    },
    planLinks: ["abbonamento OpenCode"],
    ours: {
      label: "Piani OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Regole per agente",
        copied: "Regole copiate",
      },
    },
    naming: {
      title: "Nome",
      body: "Scrivi OpenCode come una sola parola, con la O e la C maiuscole. Non scrivere Opencode, Open Code, OpenCode AI o Open-Code.",
      code: "Usa `opencode` in minuscolo solo nel codice e nei nomi dei pacchetti, come `opencode-figma` o `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Il logo da solo, per icone di app, avatar e altri spazi piccoli. Le versioni quadrate aggiungono margine per i posti che ritagliano a quadrato.",
        assets: {
          light: {
            name: "Chiaro",
          },
          dark: {
            name: "Scuro",
          },
          "square-light": {
            name: "Quadrato, chiaro",
          },
          "square-dark": {
            name: "Quadrato, scuro",
          },
        },
      },
      wordmark: {
        title: "Logotipo",
        body: "Il nome completo nelle lettere di OpenCode. Usalo ovunque ci sia spazio per scrivere il nome per intero.",
        assets: {
          light: {
            name: "Chiaro",
          },
          dark: {
            name: "Scuro",
          },
        },
      },
      "simple-wordmark": {
        title: "Logotipo semplice",
        body: "Una versione monocromatica del logotipo, per stampa, ricamo e posti che ammettono un solo colore.",
        assets: {
          light: {
            name: "Chiaro",
          },
          dark: {
            name: "Scuro",
          },
        },
      },
    },
    icons: {
      title: "Avatar",
      body: "Avatar quadrati da 1024px per Slack, Discord, GitHub e altri profili. Lo sfondo riempie tutto il quadrato e il logo sta ben dentro il cerchio, così regge un ritaglio rotondo.",
      items: {
        dark: {
          name: "Scuro",
        },
        light: {
          name: "Chiaro",
        },
      },
    },
    colors: {
      title: "Colori",
      body: "Il logo e il logotipo usano un solo inchiostro a tre opacità, con un inchiostro più chiaro per gli sfondi scuri. I valori sotto sono quell'inchiostro su bianco o su #0B0B0B, come nei file standard. Fai clic su un valore per copiarlo.",
      palettes: {
        light: {
          name: "Chiaro",
          swatches: {
            ink: {
              name: "Inchiostro",
              use: "Il contorno del logo e le lettere di «code».",
            },
            "ink-70": {
              name: "Inchiostro 70%",
              use: "Le lettere di «open».",
              ink: "L'inchiostro al 70% di opacità.",
            },
            "ink-20": {
              name: "Inchiostro 20%",
              use: "L'ombra interna del logo.",
              ink: "L'inchiostro al 20% di opacità.",
            },
          },
        },
        dark: {
          name: "Scuro",
          swatches: {
            ink: {
              name: "Inchiostro",
              use: "Il contorno del logo e le lettere di «code».",
            },
            "ink-72": {
              name: "Inchiostro 72%",
              use: "Le lettere di «open».",
              ink: "L'inchiostro al 72% di opacità.",
            },
            "ink-28": {
              name: "Inchiostro 28%",
              use: "L'ombra interna del logo.",
              ink: "L'inchiostro al 28% di opacità.",
            },
          },
        },
      },
    },
    variants: {
      title: "Varianti",
      body: "Scegli la versione che mantiene il logo leggibile sul tuo sfondo, scura su sfondi chiari e chiara su sfondi scuri. Il logo e il logotipo sono file separati, quindi usa l'uno o l'altro.",
      groups: {
        default: {
          name: "Predefinita",
          body: "Il logo da usare quasi ovunque. La sua ombra interna è trasparente. Su bianco o nero appare identico alla versione bicolore grigia, e su foto, sfumature e colori lascia trasparire lo sfondo.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Scuro",
                },
                light: {
                  name: "Chiaro",
                },
              },
            },
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Scuro",
                },
                light: {
                  name: "Chiaro",
                },
              },
            },
          },
        },
        simple: {
          name: "Semplice",
          body: "Un solo colore, con controforme aperte e senza ombra interna. Usalo su sfondi a tinta unita, per la stampa a un colore e ovunque i grigi non vadano bene, semplice scuro su colori chiari e semplice chiaro su colori scuri.",
          rows: {
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Scuro",
                },
                light: {
                  name: "Chiaro",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Uso",
      body: "Usa le versioni chiare su sfondi chiari e quelle scure su sfondi scuri. Il logo e il logotipo sono separati, quindi usa l'uno o l'altro, mai entrambi insieme.",
      stroke: {
        title: "Un tratto",
        body: "Le regole di spaziatura in questa pagina si misurano in tratti. Un tratto è lo spessore del contorno del logo, cioè un quarto della sua larghezza, quindi il logo è largo 4 tratti e alto 5.",
      },
      clearSpace: {
        title: "Spazio libero",
        body: "Lascia almeno due tratti di spazio su ogni lato del logo e del logotipo. Per il logo, un tratto è lo spessore del contorno, un quarto della larghezza. Per il logotipo, è lo spessore delle lettere, un settimo dell'altezza.",
      },
      pixels: {
        title: "Pixel interi",
        body: "Le proporzioni del logo sono fisse a 4:5, e un tratto è un quarto della sua larghezza. Ridimensionalo a passi di 4 × 5px, così ogni bordo e ogni tratto cade su un pixel intero.",
        do: "tenere ogni bordo e il tratto da 4px su pixel interi.",
        dont: "dimensionare il logo fuori dal 4:5, o i bordi cadono tra i pixel e si sfocano.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotipo",
          },
        },
      },
      minimumTitle: "Dimensioni minime",
      minimum: {
        logo: {
          title: "Logo",
          body: "Almeno 16 × 20px, con un tratto da 4px. Più piccolo si sfoca.",
        },
        wordmark: {
          title: "Logotipo",
          body: "Almeno 117 × 21px, con un tratto da 3px. Più piccolo si sfoca.",
        },
      },
    },
    donts: {
      title: "Errori",
      body: "Errori comuni da evitare quando usi il logo e il logotipo.",
      examples: {
        "two-tone": {
          caption: "ricolorare il logo con nuovi colori.",
        },
        bright: {
          caption: "usare un solo colore acceso.",
        },
        gradient: {
          caption: "riempire il logo con una sfumatura.",
        },
        inverted: {
          caption: "invertire i toni.",
        },
        stretch: {
          caption: "allungare o schiacciare il logo.",
        },
        shadow: {
          caption: "aggiungere ombre esterne.",
        },
        glow: {
          caption: "aggiungere bagliori o contorni.",
        },
        lockup: {
          caption: "mettere altre parole accanto al logo.",
        },
        "low-contrast": {
          caption: "usare grigio su grigio a basso contrasto.",
        },
        color: {
          caption: "mettere il logo bicolore grigio su uno sfondo colorato, dove i grigi diventano spenti.",
        },
      },
    },
    integrations: {
      title: "Integrazioni",
      body: "Plugin, provider e strumenti che funzionano con OpenCode, e i progetti creati con esso, possono dirlo. Usa un badge o un lockup partner, e dai al progetto un nome che chiarisca che è tuo.",
      badges: {
        body: "Metti un badge nel README, nella documentazione o sul sito e collegalo a opencode.ai. Scegli il file chiaro o scuro in base allo sfondo (l'HTML cambia da solo) e non modificare colori o testo.",
        sizes: "Ogni stile è disponibile a 20, 32 e 44px (Shields solo a 20px), in SVG e in PNG a 2×.",
        mono: "Ogni file esiste anche con testo in OpenTUI Mono. Aggiungi -mono prima dell'estensione, come in opencode-works-with-a-light-20-mono.svg, o -mono-caps per OpenTUI Mono in maiuscolo.",
        groups: {
          "works-with": {
            title: "Funziona con",
            alt: "Funziona con OpenCode",
            body: "Per plugin, provider e strumenti che funzionano con OpenCode.",
          },
          "built-with": {
            title: "Creato con",
            alt: "Creato con OpenCode",
            body: "Per progetti realizzati con OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Cornice",
          },
          c: {
            name: "Celle",
          },
          f: {
            name: "Pieno",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Lockup partner",
        body: "Metti il logo OpenCode e il logo del partner affiancati, con una × in mezzo. Lascia 3 tratti di spazio su ogni lato della ×, dimensiona il logo del partner perché sembri alto quanto il logo OpenCode e lascia spazio libero intorno all'intero lockup.",
      },
      naming: {
        title: "Dare un nome al progetto",
        body: "Metti prima il tuo nome, così è chiaro che il progetto è tuo.",
        rule: "Scrivi `Linear for OpenCode` o chiama il pacchetto `opencode-linear`. Non scrivere `OpenCode Linear` o `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marchi",
      body: "OpenCode e il logo OpenCode sono marchi di Anomaly. Non usarli per far intendere che Anomaly ti sostiene o ti sponsorizza, nel nome del tuo prodotto o della tua azienda, o su merchandising senza permesso.",
      contact: {
        before: "Per domande, scrivi a ",
      },
    },
  },
  press: {
    title: "OpenCode | Press kit con dati aziendali e asset del brand",
    description:
      "Il press kit di OpenCode, con informazioni su OpenCode e su Anomaly, l'azienda che lo sviluppa, più logo e logotipi da scaricare e un contatto per la stampa.",
    hero: {
      title: "Stampa",
      body: "Dati, asset del brand e contatti per scrivere di OpenCode e Anomaly.",
    },
    company: {
      title: "Chi è Anomaly",
      lead: "Anomaly è l'azienda dietro OpenCode. Crea strumenti open source per sviluppatori.",
      more: "Tra gli altri progetti ci sono SST e OpenTUI, tutti open source su [GitHub](github).",
      projects: {
        opencode: {
          body: "L'agente di coding open source, con app per desktop, terminale e mobile, e un SDK. Licenza MIT, oltre 220.000 stelle su GitHub.",
        },
        sst: {
          body: "Un framework per creare app full-stack sulla tua infrastruttura. Licenza MIT, open source dal 2020, oltre 26.000 stelle su GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Una libreria per UI da terminale in TypeScript, React o Solid, con un core in Zig. OpenCode la usa in produzione. Oltre 13.000 stelle su GitHub.",
        },
        "models-dev": {
          body: "Un database open source di specifiche, prezzi e capacità dei modelli di IA, con un'API pubblica. Elenca oltre 8.900 modelli di oltre 200 provider.",
        },
        hex: {
          body: "Dettatura vocale per Mac, Windows e Linux. Hex trascrive sul tuo dispositivo e incolla in qualsiasi app, quindi l'audio non lascia mai il dispositivo.",
        },
        opentunnel: {
          body: "Una CLI e un SDK che danno un URL HTTPS pubblico alle app sulla tua macchina. Il TLS termina sulla tua macchina, quindi il relay non vede mai il testo in chiaro.",
        },
      },
      learnMore: "Per saperne di più, visita [anoma.ly](site).",
    },
    about: {
      title: "Chi è OpenCode",
      boilerplate: {
        long: "OpenCode è un agente di coding open source. È disponibile come app desktop, UI da terminale, app mobile e SDK, e funziona con modelli di qualsiasi provider, tra cui Claude, GPT e Gemini. OpenCode ha licenza MIT ed è sviluppato da Anomaly. Ha oltre 220.000 stelle su GitHub e più di 1.000 contributori, e oltre 22 milioni di sviluppatori lo usano ogni mese.",
        short:
          "OpenCode è un agente di coding open source di Anomaly, con app per desktop, terminale e mobile, e un SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console è l'app web in cui sviluppatori e team acquistano e gestiscono l'accesso ai modelli di IA per OpenCode e altri agenti di coding. Offre inferenza a consumo per modelli frontier e open-weight, addebitata per richiesta su crediti prepagati, e gli abbonamenti OpenCode Go. I team hanno workspace con i ruoli Member, Admin e Owner, limiti di spesa per workspace e per utente, single sign-on con Okta, Microsoft Entra ID o Google Workspace, e SCIM. Console supporta oltre 30 provider, così i team possono collegare gli account che hanno già, e la sua inferenza è facoltativa. Si trova su opencode.ai/console.",
          short:
            "OpenCode Console è l'app web di Anomaly per l'accesso a consumo ai modelli di IA, gli abbonamenti OpenCode Go e i controlli per i team come budget e single sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go è un abbonamento per sviluppatori che vogliono un prezzo mensile fisso per i modelli di coding. Go costa 10 $/mese, Go Plus 40 $/mese con limiti più alti e Go Teams 20 $/mese per membro. Ogni piano include una selezione di modelli testati per il coding agentico. I limiti d'uso sono importi mensili in dollari per ogni modello, con quote mobili su 5 ore e settimanali pari al 20% e al 50% del limite mensile. Gli abbonati possono ricaricare credito, passare a un saldo a consumo e disdire in qualsiasi momento. Go funziona con OpenCode e altri agenti. Si trova su opencode.ai/console/go.",
          short:
            "OpenCode Go è un abbonamento mensile di Anomaly che dà agli sviluppatori limiti d'uso mensili su una selezione di modelli di coding, da 10 $/mese.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data è una dashboard pubblica che mostra quali modelli di IA gli sviluppatori usano in OpenCode e come cambia questo mix nel tempo. Pubblica una classifica dei modelli principali, l'uso dei token, i costi per sessione e per token, i rapporti di cache, le quote di mercato e una ripartizione per paese. I dati sono aggregati ogni ora, con giorni e settimane in UTC. I conteggi di utenti e sessioni sono approssimativi, e i costi usano i prezzi di listino del catalogo modelli di OpenCode. I giornalisti possono citarla come OpenCode Data (opencode.ai/data), con l'orario di aggiornamento indicato nella pagina.",
          short:
            "OpenCode Data è una dashboard pubblica su opencode.ai/data che classifica i modelli di IA in base all'uso reale in OpenCode, con token, costi e quote di mercato aggiornati ogni ora.",
        },
      },
    },
    facts: {
      title: "In breve",
      items: {
        license: {
          label: "Licenza",
        },
        "first-release": {
          label: "Prima release",
        },
        "made-by": {
          label: "Creato da",
        },
      },
    },
    milestones: {
      title: "Tappe",
      items: {
        "first-release-v0-0-1": {
          date: "Apr 2025",
          text: "Prima release, v0.0.1",
        },
        "1-million-downloads": {
          date: "Ott 2025",
          text: "Oltre 1 milione di download",
        },
        "opencode-1-0": {
          date: "Ott 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Dic 2025",
          text: "Esce l'app desktop",
        },
        "10-million-downloads": {
          date: "Gen 2026",
          text: "Oltre 10 milioni di download",
        },
        "opencode-2-0": {
          date: "Set 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Nov 2026",
          text: "220.000+ stelle su GitHub",
        },
      },
    },
    news: {
      title: "Ultime release",
      intro: "OpenCode esce spesso. Queste sono le release più recenti con nuove funzionalità.",
      changelog: {
        text: "Changelog completo",
      },
      feed: {
        text: "Feed RSS",
      },
    },
    media: {
      title: "Media",
      intro: "Immagini e brevi video di ogni app, registrati dal prodotto reale. Puoi usarli per scrivere di OpenCode.",
      note: "Tutte le acquisizioni usano il tema scuro. Immagini e poster sono JPG fino a 1920 × 1080, o 1080 × 1350 in verticale. I video sono clip MP4 senza audio.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Video Desktop",
            },
            "frame-1": {
              title: "Immagine Desktop 1",
            },
            "frame-2": {
              title: "Immagine Desktop 2",
            },
            "frame-3": {
              title: "Immagine Desktop 3",
            },
            "frame-4": {
              title: "Immagine Desktop 4",
            },
            "feature-1": {
              title: "Sessioni in schede",
            },
            "feature-2": {
              title: "Rivedi e commenta",
            },
            "feature-3": {
              title: "Guardalo nel browser",
            },
            "locked-portrait": {
              title: "Video Desktop, verticale",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Video Mobile",
            },
            "frame-1": {
              title: "Immagine Mobile 1",
            },
            "frame-2": {
              title: "Immagine Mobile 2",
            },
            "frame-3": {
              title: "Immagine Mobile 3",
            },
            "feature-1": {
              title: "Voce",
            },
            "feature-2": {
              title: "Approvazioni",
            },
            "feature-3": {
              title: "Sessioni",
            },
            "locked-portrait": {
              title: "Video Mobile, verticale",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Video Terminal",
            },
            "frame-1": {
              title: "Immagine Terminal 1",
            },
            "frame-2": {
              title: "Immagine Terminal 2",
            },
            "frame-3": {
              title: "Immagine Terminal 3",
            },
            "frame-4": {
              title: "Immagine Terminal 4",
            },
            "feature-1": {
              title: "Chiedi a parole tue",
            },
            "feature-2": {
              title: "Approva i comandi",
            },
            "feature-3": {
              title: "Fallo tuo",
            },
            "locked-portrait": {
              title: "Video Terminal, verticale",
            },
          },
        },
        sdk: {
          items: {
            "locked-landscape": {
              title: "Video SDK",
            },
            "frame-1": {
              title: "Immagine SDK 1",
            },
            "frame-2": {
              title: "Immagine SDK 2",
            },
            "frame-3": {
              title: "Immagine SDK 3",
            },
            "frame-4": {
              title: "Immagine SDK 4",
            },
            "feature-1": {
              title: "Ripara la CI da codice",
            },
            "feature-2": {
              title: "Segui ogni passo",
            },
            "feature-3": {
              title: "Crea i tuoi strumenti",
            },
            "locked-portrait": {
              title: "Video SDK, verticale",
            },
          },
        },
      },
    },
    people: {
      title: "Persone",
    },
    anomalyLogo: {
      title: "Logo Anomaly",
      body: "Il simbolo e il logotipo di Anomaly, in nero e in bianco. I PNG sono larghi 2048 px.",
      assets: {
        "mark-black": {
          name: "Simbolo, nero",
        },
        "mark-white": {
          name: "Simbolo, bianco",
        },
        "wordmark-black": {
          name: "Logotipo, nero",
        },
        "wordmark-white": {
          name: "Logotipo, bianco",
        },
      },
      all: {
        text: "Scarica tutto",
      },
    },
    coverage: {
      title: "Rassegna",
    },
    brand: {
      title: "Brand",
      before:
        "Scarica i logo e i logotipi di OpenCode in un unico file ZIP. Per i singoli file, le varianti e le regole d'uso, vai alla ",
      link: {
        text: "pagina Brand",
      },
      usage:
        "Puoi usare questi file per scrivere di OpenCode. Non modificarli e non far intendere che OpenCode sostenga il tuo lavoro.",
    },
    product: {
      title: "Prodotto",
      items: {
        desktop: {
          name: "Desktop",
          body: "Esegui più agenti insieme, ognuno nella sua scheda, su macOS, Windows e Linux. Rivedi ogni modifica come diff e guardane l'anteprima.",
        },
        mobile: {
          name: "Mobile",
          body: "L'app OpenCode più recente. Chiama una sessione per parlare con l'agente, poi rivedi e approva le sue modifiche dal telefono, ovunque.",
        },
        terminal: {
          name: "Terminal",
          body: "Un'interfaccia da terminale che funziona in qualsiasi shell, editor o server remoto. Vedi ogni modifica come diff e scegli quali comandi partono da soli.",
        },
        sdk: {
          body: "Un client TypeScript tipizzato per script, job di CI e i tuoi strumenti. Crea sessioni, invia prompt e trasmetti ogni evento in tempo reale.",
        },
      },
    },
    contact: {
      title: "Contatti",
      items: {
        press: {
          title: "Stampa",
          body: "Per giornalisti e analisti. Rispondiamo solo alle richieste dei media.",
        },
        support: {
          title: "Supporto",
          body: "Per aiuto con OpenCode, apri una issue o chiedi alla community. Per domande su account e fatturazione, scrivici.",
          links: {
            "github-issues": {
              text: "Issue su GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Sicurezza",
          body: "Segnala una vulnerabilità tramite GitHub. Se nessuno risponde entro 6 giorni lavorativi, scrivici.",
          links: {
            "report-a-vulnerability": {
              text: "Segnala una vulnerabilità",
            },
            "security-anoma-ly": {
              text: "security@anoma.ly",
            },
          },
        },
      },
    },
  },
  download: {
    desktop: {
      title: "Desktop",
    },
    mobile: {
      title: "Mobile",
      stores: {
        "google-play": {
          label: "Google Play",
        },
      },
    },
    terminal: {
      title: "Terminal",
      installs: {
        curl: {
          name: "Script",
        },
      },
    },
    extensions: {
      title: "Estensioni",
      items: {
        cursor: {
          label: "Cursor",
        },
        zed: {
          label: "Zed",
        },
        windsurf: {
          label: "Windsurf",
        },
        vscodium: {
          label: "VSCodium",
        },
      },
    },
    faq: {
      items: {},
    },
  },
  productDownloads: {
    sdk: {
      more: {
        label: "Leggi la documentazione dell'SDK",
      },
    },
    ide: {
      lead: "Esegui opencode nel terminale integrato del tuo editor e l'estensione si installa da sola, oppure installala tu.",
      more: {
        label: "Configura Zed, gli IDE JetBrains e altri editor ACP",
      },
      links: {
        "vs-code-marketplace": {
          label: "VS Code Marketplace",
        },
        "open-vsx-cursor-windsurf-vscodium": {
          label: "Open VSX (Cursor, Windsurf, VSCodium)",
        },
      },
    },
    mini: {
      lead: "Mini è incluso nella CLI di OpenCode. Installala con uno di questi comandi, poi esegui opencode mini.",
      commands: {
        curl: {
          name: "Script",
        },
      },
    },
    terminal: {
      commands: {
        curl: {
          name: "Script",
        },
      },
    },
  },
  pair: {
    title: "Collega il telefono",
    cardTitle: "Abbina il telefono con un solo comando",
    intro:
      "OpenCode Mobile è un telecomando per OpenCode sul tuo computer. Le sessioni continuano a girare lì, e l'app le mostra e ti permette di guidarle.",
    steps: {
      "get-the-app": {
        title: "Scarica l'app",
        body: "Installa la beta di OpenCode sul tuo iPhone da TestFlight. L'app Android arriverà presto.",
      },
      "run-this-on-your-computer": {
        title: "Esegui questo sul computer",
        body: "Stampa un link monouso e un codice QR. Funzionano una sola volta e scadono dopo 5 minuti.",
      },
      "scan-the-code": {
        title: "Scansiona il codice",
        body: "Scansiona il codice QR con l'app o incolla il link. Le sessioni recenti del computer si aprono sul telefono.",
      },
    },
    note: "--remote si collega tramite un indirizzo OpenTunnel, quindi funziona da qualsiasi rete. Sulla stessa rete Wi-Fi, esegui una volta opencode service set hostname 0.0.0.0, poi opencode pair.",
    facts: [
      "L'abbinamento funziona da qualsiasi rete, perché --remote si collega tramite un indirizzo OpenTunnel.",
      "Il link e il codice funzionano una sola volta e scadono dopo 5 minuti.",
      "Tieni acceso il computer, perché l'agente gira lì e non sul telefono.",
      "Sulla stessa rete Wi-Fi, esegui una volta opencode service set hostname 0.0.0.0, poi opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Crea, installa e condividi plugin desktop.",
      link: "Novità della 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "I terminali desktop ora sopravvivono ai riavvii.",
      link: "Vedi la v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Ora gli agenti possono generare immagini.",
      link: "Vedi la v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Guida le sessioni dal telefono.",
      link: "Scopri OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Un'app desktop rinnovata.",
      link: "Novità della 2.2",
    },
  },
} satisfies ContentOverlay
