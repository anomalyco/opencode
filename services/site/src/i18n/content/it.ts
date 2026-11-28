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
    mini: {
      body: "Un'interfaccia da terminale essenziale. Le risposte restano nella cronologia, con un solo prompt in basso.",
      action: "Installa",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App desktop per macOS, Windows e Linux",
      description:
        "Esegui in parallelo tutti gli agenti OpenCode che vuoi, controlla ogni modifica nel browser a fianco e riprendi il lavoro da qualsiasi dispositivo. Per macOS, Windows e Linux.",
      intro:
        "Esegui più agenti in parallelo, ogni sessione nella propria scheda. Esamina i diff, commenta qualsiasi riga e controlla il risultato nel browser integrato. Per macOS, Windows e Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agenti in parallelo",
          body: "Avvia tutti gli agenti che vuoi e lasciali lavorare in parallelo. Passa dall'uno all'altro man mano che finiscono.",
        },
        "see-it-in-the-browser": {
          title: "Anteprima nel browser",
          body: "Apri la tua app nel browser a fianco dell'agente. Entrambi vedete le modifiche in tempo reale.",
        },
        "on-every-device": {
          title: "Su ogni dispositivo",
          body: "Avvia gli agenti da qualsiasi dispositivo e riprendi il lavoro da Desktop, dal terminale o dal telefono.",
        },
        "extend-it": {
          title: "Estendilo",
          body: "Collega i tuoi strumenti e servizi per dare all'agente accesso a tutto ciò che usi. Oppure chiedi a OpenCode di scrivere i propri plugin, con un'interfaccia dedicata nella barra laterale.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, le tue sessioni di coding sul telefono",
      description:
        "Avvia e guida le sessioni OpenCode dal telefono. Parla con l'agente mentre lavora sul tuo computer.",
      intro:
        "Avvia e guida le sessioni dal telefono, ovunque tu sia. Chiama una sessione per parlare con l'agente o aprine una per riprendere da dove avevi lasciato. OpenCode continua a girare sul tuo computer.",
      showcase: {
        voice: {
          title: "Voce",
          body: "Chiama una sessione e di' cosa ti serve. L'agente risponde a voce.",
        },
        sessions: {
          title: "Sessioni",
          body: "Apri qualsiasi sessione per vedere a che punto è, poi riprendi da dove avevi lasciato.",
        },
        results: {
          title: "Risultati",
          body: "A lavoro finito, l'agente ti dice in chiamata cosa ha modificato.",
        },
      },
    },
    terminal: {
      title: "OpenCode | UI da terminale per l'agente di coding open source",
      description:
        "Un'interfaccia da terminale veloce per OpenCode che funziona in qualsiasi shell, editor o server remoto. Descrivi cosa vuoi, vedi ogni modifica come diff e approva i comandi.",
      intro:
        "Un'interfaccia da terminale veloce per qualsiasi shell, editor o server remoto. Spiega a parole tue cosa ti serve, segui le modifiche nei diff e scegli quali comandi eseguire in automatico.",
      features: {
        "any-terminal": {
          title: "Ogni terminale",
          body: "Funziona in qualsiasi shell, nel terminale del tuo editor o su un server remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diff nella timeline",
          body: "Segui nella timeline i diff delle modifiche man mano che l'agente le apporta.",
        },
        "pick-up-later": {
          title: "Riprendi più tardi",
          body: "Riprendi l'ultima sessione con -c o una sessione a tua scelta con -s.",
        },
        "one-off-runs": {
          title: "Esecuzioni singole",
          body: "opencode run invia un messaggio e stampa la risposta.",
        },
        "agents-and-commands": {
          title: "Agenti e comandi",
          body: "Cambia agente con shift+tab e apri tutti i comandi con ctrl+p.",
        },
        "auto-approve": {
          title: "Approva in automatico",
          body: "Avvia con --auto per consentire ogni azione che non hai negato.",
        },
        "any-server": {
          title: "Ogni server",
          body: "Collegati a un server OpenCode tramite URL con --server.",
        },
        "usage-stats": {
          title: "Statistiche di utilizzo",
          body: "opencode stats mostra statistiche di utilizzo che puoi condividere.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Chiedi a parole tue",
          body: "Scrivi cosa ti serve. L'agente ti mostra il suo piano mentre lavora.",
        },
        "approve-what-runs": {
          title: "Approva i comandi",
          body: "Le modifiche appaiono come diff e i comandi aspettano il tuo permesso.",
        },
        "make-it-yours": {
          title: "Personalizza il terminale",
          body: "Passa dal tema predefinito a tokyonight o a un altro tema con un solo tasto.",
        },
        mini: {
          title: "Mini",
          body: "Esegui opencode mini per leggere le risposte nella cronologia del terminale.",
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
          title: "Qualsiasi modello",
          body: "Usa i modelli configurati nel tuo OpenCode.",
        },
        "npm-or-bun": {
          title: "npm o Bun",
          body: "Installalo con npm i @opencode/sdk o bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host in-process",
          body: "Esegue OpenCode in memoria, senza passare dalla rete.",
        },
        "your-plugins": {
          title: "I tuoi plugin",
          body: "Passa i tuoi plugin al momento di creare l'host in-process.",
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
          title: "Correggi la CI da codice",
          body: "Un breve script chiede a OpenCode di correggere i test non riusciti, poi li esegue di nuovo.",
        },
        "follow-every-step": {
          title: "Segui ogni passo",
          body: "Ricevi gli eventi in streaming e vedi in tempo reale ogni strumento che l'agente chiama.",
        },
        "build-your-own-tools": {
          title: "Crea i tuoi strumenti",
          body: "Integra OpenCode in bot, dashboard e flussi di lavoro con poche righe.",
        },
        "in-your-process": {
          title: "Nel tuo processo",
          body: "Esegue OpenCode nel tuo processo, con la tua configurazione e i tuoi modelli.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, l'interfaccia da terminale essenziale per l'agente",
      description:
        "Mini esegue OpenCode in un'interfaccia da terminale essenziale. Le risposte restano nella cronologia del terminale. In basso trovi solo un prompt e una riga di stato.",
      intro:
        "L'interfaccia da terminale essenziale per OpenCode. Esegui opencode mini e ritrovi le risposte nella cronologia del terminale, dove puoi scorrerle, cercarle e copiarle come qualsiasi altro output. In basso restano solo il prompt e una riga di stato.",
      features: {
        "your-scrollback": {
          title: "Cronologia del terminale",
          body: "Le risposte entrano nella cronologia del terminale come qualsiasi altro output.",
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
          title: "Riprendi più tardi",
          body: "Riprendi l'ultima sessione con -c o una sessione a tua scelta con -s.",
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
      body: "Fai usare agli agenti il browser che usi già.",
      title: "OpenCode | Browse, il tuo browser per gli agenti di coding",
      description:
        "Con Browse, OpenCode e gli altri client MCP usano il tuo browser. Gli agenti leggono le pagine, fanno clic, digitano, scattano screenshot e registrano le schede. Per l'accesso o la 2FA riprendi tu il controllo.",
      intro:
        "Un server MCP e un'estensione Chromium permettono agli agenti di usare il tuo browser, con le schede, gli accessi e le estensioni che hai già. Gli agenti aprono le proprie schede in gruppi separati e in background. Possono leggere le pagine, fare clic, digitare, scattare screenshot e registrare le schede. Per un accesso, la 2FA o un pagamento, ti lasciano il controllo della scheda e ripartono quando fai clic su Continua.",
      features: {
        "your-real-browser": {
          title: "Il browser che usi già",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera e Chromium.",
        },
        "out-of-your-way": {
          title: "Schede in background",
          body: "Le schede degli agenti si aprono in background, in gruppi chiusi.",
        },
        handoffs: {
          title: "A te il controllo",
          body: "Accedi o completa la verifica 2FA, poi fai clic su Continua.",
        },
        "lend-a-tab": {
          title: "Presta una scheda",
          body: "Fai clic sul pulsante nella barra per affidare a un agente una scheda aperta.",
        },
        "record-and-capture": {
          title: "Registra e cattura",
          body: "Screenshot, registrazioni di schede e traffico di rete.",
        },
        "any-mcp-client": {
          title: "Qualsiasi client MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed e molti altri.",
        },
        "all-your-logins": {
          title: "Tutti i tuoi accessi",
          body: "Gli agenti usano i siti a cui hai già effettuato l'accesso. Niente chiavi, niente configurazione.",
        },
        "allowed-sites": {
          title: "Siti consentiti",
          body: "Limita la navigazione dell'agente ai siti che scegli.",
        },
      },
      install:
        "Installa prima l'[estensione di Chrome], che ti guida nei passaggi successivi. Se devi installare direttamente la CLI (di solito non serve), usa uno di questi metodi.",
    },
  },
  apps: {
    browse: {
      category: "Controllo del browser per agenti",
      body: "Dai all'agente accesso al tuo browser, con le schede e gli accessi che usi già.",
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
    lead: "Per iniziare, scarica OpenCode e usa i modelli gratuiti, senza account. Per accedere ad altri modelli, usa il tuo abbonamento oppure OpenCode Go.",
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
        title: "Usa i modelli gratuiti",
        line: "OpenCode include una serie di modelli gratuiti. Nessun account necessario.",
      },
      "add-more-models": {
        title: "Aggiungi altri modelli",
        line: "Usa il tuo abbonamento oppure accedi ai modelli selezionati di OpenCode Go da $10/mese.",
      },
    },
    sentence:
      "Scarica OpenCode e inizia con i modelli gratuiti. Per accedere ad altri modelli, collega il tuo abbonamento o passa a OpenCode Go.",
  },
  byos: {
    title: "Collega il tuo abbonamento",
    headline: "Usa gli abbonamenti che hai già.",
    line: "Accedi con ChatGPT Plus o Pro o con GitHub Copilot. In alternativa, usa un abbonamento OpenCode.",
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
        text: "Regole per l'agente",
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
        body: "Il logo da solo, per icone delle app, avatar e altri spazi ridotti. Le versioni quadrate hanno un margine aggiuntivo per le app e i siti che applicano un ritaglio quadrato.",
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
        body: "Il nome per esteso con i caratteri di OpenCode. Usalo dove c'è spazio per il nome completo.",
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
        body: "La versione monocromatica del logotipo, per stampa, ricamo e altri usi che ammettono un solo colore.",
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
      body: "Avatar quadrati da 1024px per Slack, Discord, GitHub e altri profili. Lo sfondo copre tutto il quadrato e il logo resta all'interno del cerchio, senza tagli nel ritaglio circolare.",
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
      body: "Il logo e il logotipo usano un solo inchiostro a tre livelli di opacità e un inchiostro più chiaro per gli sfondi scuri. Qui trovi i colori dei file standard. Usali solo per il logo e il logotipo, non per altri testi o sfondi. Fai clic su un valore per copiarlo.",
      palettes: {
        light: {
          name: "Chiaro",
          swatches: {
            ink: {
              name: "Inchiostro",
              use: "Il contorno del logo e le lettere di “code”.",
            },
            "ink-70": {
              name: "Inchiostro 70%",
              use: "Le lettere di “open”.",
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
              use: "Il contorno del logo e le lettere di “code”.",
            },
            "ink-72": {
              name: "Inchiostro 72%",
              use: "Le lettere di “open”.",
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
      body: "Puoi indicare che un plugin, un provider o uno strumento funziona con OpenCode o che hai creato un progetto con OpenCode. Usa un badge o un lockup per partner e scegli un nome che identifichi il progetto come tuo.",
      badges: {
        body: "Metti un badge nel README, nella documentazione o sul sito e collegalo a opencode.ai. Scegli il file chiaro o scuro in base allo sfondo (l'HTML cambia da solo) e non modificare colori o testo.",
        sizes: "Ogni stile è disponibile a 20, 32 e 44px (Shields solo a 20px), in SVG e in PNG a 2×.",
        mono: "Tutti i file sono disponibili anche con testo in OpenMono. Aggiungi -mono prima dell'estensione, come in opencode-works-with-a-light-20-mono.svg, oppure -mono-caps per OpenMono in maiuscolo.",
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
        title: "Lockup per partner",
        body: "Affianca il logo OpenCode a quello del partner, con un segno × in mezzo. Lascia 3 tratti di spazio ai due lati del segno, allinea l'altezza visiva dei due logo e lascia spazio libero intorno a tutto il lockup.",
      },
      naming: {
        title: "Dare un nome al progetto",
        body: "Metti per primo il nome del tuo progetto, così è chiaro chi lo ha creato.",
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
      lead: "Anomaly sviluppa OpenCode e altri strumenti open source per sviluppatori.",
      more: "Tra gli altri progetti ci sono SST e OpenTUI, tutti open source su [GitHub](github).",
      projects: {
        opencode: {
          body: "L'agente di coding open source, con app per desktop, terminale e mobile, oltre a un SDK. Licenza MIT e 220,000+ stelle su GitHub.",
        },
        sst: {
          body: "Un framework per creare app full-stack sulla tua infrastruttura. Licenza MIT, open source dal 2020, oltre 26,000 stelle su GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Una libreria per UI da terminale in TypeScript, React o Solid, con un core in Zig. OpenCode la usa in produzione. Oltre 13,000 stelle su GitHub.",
        },
        "models-dev": {
          body: "Un database open source con specifiche, prezzi e funzionalità dei modelli AI e un'API pubblica. Include 8,900+ modelli di oltre 200 provider.",
        },
        hex: {
          body: "Dettatura vocale per Mac, Windows e Linux. Hex trascrive sul dispositivo e incolla il testo in qualsiasi app. L'audio non lascia mai il dispositivo.",
        },
        opentunnel: {
          body: "Una CLI e un SDK che assegnano un URL HTTPS pubblico alle app in esecuzione sul tuo computer. La connessione TLS termina sul tuo computer, quindi il relay non vede mai il testo in chiaro.",
        },
      },
      learnMore: "Per saperne di più, visita [anoma.ly](site).",
    },
    about: {
      title: "Informazioni su OpenCode",
      body: "Descrizioni di OpenCode e dei suoi prodotti in versione lunga e breve, pronte da copiare.",
      boilerplate: {
        long: "OpenCode è un agente di coding open source. È disponibile come app desktop, interfaccia da terminale, app mobile e SDK. Funziona con i modelli di qualsiasi provider, inclusi Claude, GPT e Gemini. Anomaly lo sviluppa con licenza MIT. Su GitHub conta oltre 220,000 stelle e più di 1,000 contributori. Ogni mese lo usano oltre 22 milioni di sviluppatori.",
        short:
          "OpenCode è un agente di coding open source di Anomaly, con app per desktop, terminale e mobile, e un SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console è l'app web in cui sviluppatori e team acquistano e gestiscono l'accesso ai modelli AI per OpenCode e altri agenti di coding. Offre gli abbonamenti OpenCode Go e l'inferenza a consumo per modelli di frontiera e open-weight. Ogni richiesta a consumo si paga con i crediti prepagati. I team hanno a disposizione spazi di lavoro con ruoli Member, Admin e Owner, limiti di spesa per spazio di lavoro e per utente, single sign-on con Okta, Microsoft Entra ID o Google Workspace e SCIM. Console supporta oltre 30 provider: i team possono collegare gli account che usano già. L'inferenza di OpenCode è facoltativa. Trovi Console su opencode.ai/console.",
          short:
            "OpenCode Console è l'app web di Anomaly per accedere ai modelli AI a consumo, gestire gli abbonamenti OpenCode Go e configurare controlli per i team, tra cui budget e single sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go dà agli sviluppatori accesso a modelli di coding a un prezzo mensile fisso. Go costa $10/mese, Go Plus $40/mese con limiti più alti e Go Teams $20/mese per membro. Ogni piano include una selezione di modelli testati con agenti di coding. Ogni modello ha un limite mensile di utilizzo espresso in dollari. Le quote, calcolate su finestre mobili di 5 ore e una settimana, sono pari rispettivamente al 20% e al 50% del limite mensile. Puoi ricaricare il credito, passare al pagamento a consumo e disdire quando vuoi. Go funziona con OpenCode e altri agenti. Lo trovi su opencode.ai/console/go.",
          short:
            "OpenCode Go è l'abbonamento mensile di Anomaly che dà agli sviluppatori accesso a una selezione di modelli di coding con limiti mensili di utilizzo, da $10/mese.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data è una dashboard pubblica che mostra quali modelli AI usano gli sviluppatori in OpenCode e come cambia il loro utilizzo nel tempo. Pubblica una classifica dei modelli più usati, l'utilizzo dei token, i costi per sessione e per token, i rapporti di cache, le quote di mercato e i dati per paese. OpenCode Data aggrega i dati ogni ora e calcola giorni e settimane in UTC. Il numero di utenti e sessioni è approssimativo. I costi si basano sui prezzi di listino del catalogo di OpenCode. La stampa può citare OpenCode Data (opencode.ai/data) con l'orario di aggiornamento riportato nella pagina.",
          short:
            "OpenCode Data è la dashboard pubblica su opencode.ai/data che classifica i modelli AI in base all'utilizzo effettivo in OpenCode, con token, costi e quote di mercato aggiornati ogni ora.",
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
          text: "220,000+ stelle su GitHub",
        },
      },
    },
    news: {
      title: "Ultime release",
      intro: "Pubblichiamo aggiornamenti frequenti. Ecco le ultime release che introducono nuove funzionalità.",
      changelog: {
        text: "Changelog completo",
      },
      feed: {
        text: "Feed RSS",
      },
    },
    media: {
      title: "Media",
      intro: "Immagini e brevi video ripresi direttamente dalle app. Puoi usarli per scrivere di OpenCode.",
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
              title: "Agenti in parallelo",
            },
            "feature-2": {
              title: "Anteprima nel browser",
            },
            "feature-3": {
              title: "Su ogni dispositivo",
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
              title: "Sessioni",
            },
            "feature-3": {
              title: "Risultati",
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
              title: "Personalizza il terminale",
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
              title: "Correggi la CI da codice",
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
      avatars: {
        body: "Avatar quadrati per X, GitHub, Slack, LinkedIn e altri profili. Il simbolo sta ben dentro il cerchio, così regge un ritaglio rotondo. I PNG sono larghi 1024 e 400 px.",
        items: {
          "avatar-dark": { name: "Avatar, scuro" },
          "avatar-light": { name: "Avatar, chiaro" },
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
          body: "Per assistenza con OpenCode, apri una issue o chiedi alla community. Per domande su account e fatturazione, scrivici.",
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
  },
  productDownloads: {
    sdk: {
      more: {
        label: "Leggi la documentazione dell'SDK",
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
      "Con OpenCode Mobile controlli OpenCode sul tuo computer. Le sessioni continuano a girare sul computer e puoi seguirle e guidarle dall'app.",
    steps: {
      "get-the-app": {
        title: "Scarica l'app",
        body: "Installa OpenCode su iPhone dall'App Store oppure sul tuo telefono Android da Google Play.",
      },
      "run-this-on-your-computer": {
        title: "Esegui il comando sul computer",
        body: "Il comando mostra un link monouso e un codice QR. Puoi usarli una sola volta e scadono dopo 5 minuti.",
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
      text: "I terminali di Desktop restano attivi dopo il riavvio.",
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
