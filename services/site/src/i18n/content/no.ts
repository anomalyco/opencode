import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Økter, faner, differ, innebygd nettleser og utvidelser på macOS, Windows og Linux.",
      action: "Last ned",
    },
    mobile: {
      name: "Mobile",
      body: "Start, styr og godkjenn økter fra telefonen, uansett hvor du er.",
      action: "Last ned",
    },
    terminal: {
      name: "Terminal",
      body: "Et raskt terminalgrensesnitt for alle shell, editorer og eksterne servere.",
      action: "Installer",
    },
    sdk: { body: "Styr OpenCode fra egne skript, CI-jobber og verktøy.", action: "Les dokumentasjonen" },
    mini: {
      body: "Et enkelt terminalgrensesnitt. Svarene vises i rullehistorikken, med én prompt nederst.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktop-app for macOS, Windows og Linux",
      description:
        "Kjør så mange OpenCode-agenter du vil parallelt. Følg hver endring i nettleseren ved siden av, og fortsett på hvilken som helst enhet. For macOS, Windows og Linux.",
      intro:
        "Kjør flere agenter samtidig, med én fane per økt. Se hver endring som en diff, kommenter direkte på kodelinjene og sjekk resultatet i den innebygde nettleseren. For macOS, Windows og Linux.",
      showcase: {
        "parallel-agents": {
          title: "Parallelle agenter",
          body: "Start så mange agenter du vil, og la dem alle jobbe parallelt. Bytt mellom dem etter hvert som de blir ferdige.",
        },
        "see-it-in-the-browser": {
          title: "Se det i nettleseren",
          body: "Appen åpnes i en nettleser ved siden av agenten. Der kan dere begge følge endringene mens de skjer.",
        },
        "on-every-device": {
          title: "På alle enheter",
          body: "Start agenter på alle enhetene dine, og fortsett i desktop-appen, terminalen eller på telefonen.",
        },
        "extend-it": {
          title: "Utvid OpenCode",
          body: "Koble til verktøyene og tjenestene dine, så agenten kan jobbe med hva som helst. Eller la OpenCode lage egne plugins med grensesnitt i sidepanelet.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile – kodeøktene dine på telefonen",
      description:
        "Start og styr OpenCode-økter fra telefonen. Snakk med agenten mens den jobber på datamaskinen din.",
      intro:
        "Start og styr økter fra telefonen, uansett hvor du er. Ring agenten i en økt, eller åpne en økt og fortsett der du slapp. OpenCode kjører på din egen maskin.",
      showcase: {
        voice: { title: "Stemme", body: "Ring agenten i en økt og si hva du trenger. Agenten svarer med stemmen." },
        sessions: { title: "Økter", body: "Åpne en økt, se hvor langt agenten har kommet, og fortsett der du slapp." },
        results: { title: "Resultater", body: "Når jobben er ferdig, får du høre hva som ble endret." },
      },
    },
    terminal: {
      title: "OpenCode | Terminalgrensesnitt for kodingsagenten med åpen kildekode",
      description:
        "Et raskt terminalgrensesnitt for OpenCode som fungerer i alle shell, editorer og eksterne servere. Beskriv hva du vil, se hver endring som en diff og godkjenn terminalkommandoer.",
      intro:
        "Et raskt terminalgrensesnitt for alle shell, editorer og eksterne servere. Beskriv hva du vil med egne ord, følg endringene som differ, og velg hvilke terminalkommandoer som skal kjøre automatisk.",
      features: {
        "any-terminal": {
          title: "Alle terminaler",
          body: "Fungerer i alle shell, i terminalen i editoren din eller på en ekstern server.",
        },
        "diffs-in-the-timeline": {
          title: "Differ i tidslinjen",
          body: "Se hver endring som en diff i tidslinjen mens agenten gjør den.",
        },
        "pick-up-later": {
          title: "Fortsett senere",
          body: "Fortsett den siste økten med -c, eller velg en annen økt med -s.",
        },
        "one-off-runs": { title: "Enkeltkjøringer", body: "opencode run sender én melding og skriver ut svaret." },
        "agents-and-commands": {
          title: "Agenter og kommandoer",
          body: "Bytt agent med shift+tab og finn alle kommandoene med ctrl+p.",
        },
        "auto-approve": {
          title: "Autogodkjenn",
          body: "Kjør med --auto for å tillate alle handlinger du ikke har avvist.",
        },
        "any-server": { title: "Alle servere", body: "Koble til en OpenCode-server via URL med --server." },
        "usage-stats": { title: "Bruksstatistikk", body: "opencode stats viser bruksstatistikk du kan dele." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Spør med egne ord",
          body: "Skriv hva du vil, så viser agenten planen sin mens den jobber.",
        },
        "approve-what-runs": {
          title: "Godkjenn før kjøring",
          body: "Endringer vises som differ, og terminalkommandoer venter på tillatelsen din.",
        },
        "make-it-yours": {
          title: "Gjør det til ditt",
          body: "Bytt tema med ett tastetrykk. Velg standardtemaet, tokyonight eller et annet.",
        },
        mini: { title: "Mini", body: "Kjør opencode mini, så vises svarene i rullehistorikken din." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK for skript, CI-jobber og verktøy",
      description:
        "Styr OpenCode fra egne skript, CI-jobber og verktøy. Den typesikre TypeScript-klienten oppretter økter, sender prompter og strømmer alle hendelser idet de skjer.",
      intro:
        "Styr OpenCode fra egne skript, CI-jobber og verktøy. SDK-et kjører OpenCode i din egen prosess, med konfigurasjonen og modellene dine. Den typesikre klienten oppretter økter, sender prompter og strømmer alle hendelser.",
      features: {
        "typescript-client": {
          title: "TypeScript-klient",
          body: "Typede forespørsler og hendelser, med de samme verdiene som @opencode/client.",
        },
        "sessions-from-code": {
          title: "Økter fra kode",
          body: "Opprett økter og send prompter fra et hvilket som helst skript.",
        },
        "any-model": { title: "Alle modeller", body: "Bruker modellene du har satt opp i OpenCode." },
        "npm-or-bun": {
          title: "npm eller bun",
          body: "Installer med npm i @opencode/sdk eller bun add @opencode/sdk.",
        },
        "in-process-host": { title: "Vert i egen prosess", body: "Kjører OpenCode i minnet, uten et ekstra nettverkshopp." },
        "your-plugins": { title: "Egne plugins", body: "Legg til egne plugins når du oppretter verten i prosessen din." },
        "promise-or-effect": {
          title: "Promise eller Effect",
          body: "Et Promise-API og et Effect-API med de samme verdiene.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Kjør OpenCode i et Cloudflare Durable Object på Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Fiks CI fra kode",
          body: "Et kort skript ber OpenCode fikse tester som feiler, og kjører dem så på nytt.",
        },
        "follow-every-step": {
          title: "Følg hvert steg",
          body: "Strøm hendelser og følg hvert verktøykall mens det skjer.",
        },
        "build-your-own-tools": {
          title: "Lag egne verktøy",
          body: "Koble OpenCode til boter, dashbord og arbeidsflyter med noen få linjer kode.",
        },
        "in-your-process": {
          title: "I prosessen din",
          body: "Kjører OpenCode i prosessen din, med konfigurasjonen og modellene dine.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, et minimalt terminalgrensesnitt for agenten",
      description:
        "Mini kjører OpenCode i et enkelt terminalgrensesnitt. Svarene vises i terminalens rullehistorikk. Nederst ligger bare en prompt og en statuslinje.",
      intro:
        "Et enkelt terminalgrensesnitt for OpenCode. Kjør opencode mini, så vises svarene rett i terminalens rullehistorikk. Bla, søk og kopier som i resten av terminalen. Nederst ligger bare prompten og en statuslinje.",
      features: {
        "your-scrollback": { title: "Din rullehistorikk", body: "Svarene blir vanlig terminalhistorikk." },
        "one-prompt": { title: "Én prompt", body: "Agent, modell, kontekst og kostnad på én statuslinje." },
        permissions: { title: "Tillatelser", body: "Tillat endringer og terminalkommandoer fra promptområdet." },
        "how-much-shows": {
          title: "Hvor mye du ser",
          body: "Velg stille, standard eller alt for resonnering og svar fra verktøy.",
        },
        "pick-up-later": {
          title: "Fortsett senere",
          body: "Fortsett den siste økten med -c, eller velg en annen økt med -s.",
        },
        "same-opencode": { title: "Samme OpenCode", body: "Samme server, agenter og modeller som de andre appene." },
        agents: { title: "Agenter", body: "Bytt agent rett fra prompten." },
        compact: { title: "Komprimer", body: "Komprimer en lang økt med /compact." },
      },
    },
  },
  extensionCard: {
    name: "Utvidelser",
    body: "Bruk OpenCode i VS Code eller via ACP i Zed og andre editorer.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "La agentene bruke nettleseren din.",
      title: "OpenCode | Browse – nettleseren din for kodingsagenter",
      description:
        "Med Browse kan OpenCode og andre MCP-klienter bruke nettleseren din. Agentene kan lese, klikke, skrive og ta skjermbilder og opptak av faner. Du tar over ved innlogging og 2FA.",
      intro:
        "Browse består av en MCP-server og en Chromium-utvidelse. Agentene bruker nettleseren din med fanene, innloggingene og utvidelsene dine. De grupperer fanene de åpner i bakgrunnen, leser sider, klikker, skriver og tar skjermbilder og opptak av faner. Ved innlogging, 2FA eller betaling får du kontroll over fanen. Agenten fortsetter når du klikker på Continue.",
      features: {
        "your-real-browser": {
          title: "Din egen nettleser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera og Chromium.",
        },
        "out-of-your-way": {
          title: "I bakgrunnen",
          body: "Agentenes faner åpnes i bakgrunnen, i grupper som er foldet sammen.",
        },
        handoffs: { title: "Din tur", body: "Logg inn eller fullfør 2FA selv. Klikk deretter på Continue." },
        "lend-a-tab": {
          title: "Lån ut fane",
          body: "Klikk på knappen i verktøylinjen for å gi en agent en åpen fane.",
        },
        "record-and-capture": {
          title: "Skjermbilder og opptak",
          body: "Skjermbilder, opptak av faner og nettverkstrafikk.",
        },
        "any-mcp-client": {
          title: "Alle MCP-klienter",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed og mange flere.",
        },
        "all-your-logins": {
          title: "Alle innloggingene dine",
          body: "Agentene bruker nettstedene du allerede er logget inn på. Du trenger verken nøkler eller oppsett.",
        },
        "allowed-sites": { title: "Tillatte nettsteder", body: "Begrens agentens fane til nettstedene du velger." },
      },
      install:
        "Installer [Chrome-utvidelsen] først. Den viser deg resten av oppsettet. Du skal ikke trenge å installere CLI-en separat, men du kan bruke en av disse metodene hvis du vil.",
    },
  },
  apps: {
    browse: {
      category: "Nettleserstyring for agenter",
      body: "La agenten bruke nettleseren din, med innlogginger og faner.",
    },
    opentunnel: { category: "Lokale tunneler", body: "Offentlige HTTPS-URL-er for lokale apper." },
    opentui: { category: "Bibliotek", body: "Et bibliotek for terminalgrensesnitt." },
    hex: { category: "Diktering", body: "Dikter i hvilken som helst app. Alt skjer på enheten." },
  },
  getStarted: {
    title: "Kom i gang",
    lead: "Den enkleste måten å komme i gang på er å laste ned OpenCode og bruke gratis modeller. Du trenger ingen konto. For flere modeller kan du bruke ditt eget abonnement eller OpenCode Go.",
    phrases: {
      "download-opencode": { text: "laste ned OpenCode" },
      "free-models": { text: "gratis modeller" },
      "your-own-subscription": { text: "ditt eget abonnement" },
      "a-subscription-you-already-have": { text: "et abonnement du allerede har" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "Last ned", line: "Desktop, Terminal eller Mobile." },
      "use-free-models": {
        title: "Bruk gratis modeller",
        line: "OpenCode har flere gratis modeller. Du trenger ingen konto.",
      },
      "add-more-models": {
        title: "Legg til modeller",
        line: "Bruk ditt eget abonnement eller få utvalgte modeller med OpenCode Go fra $10/måned.",
      },
    },
    sentence:
      "Last ned OpenCode og start med gratis modeller. Bruk ditt eget abonnement eller OpenCode Go når du vil ha flere.",
  },
  byos: {
    title: "Bruk eget abonnement",
    headline: "Bruk abonnementene du allerede har.",
    line: "Logg inn med ChatGPT Plus/Pro eller GitHub Copilot, eller bruk et OpenCode-abonnement.",
    yours: { label: "Ditt abonnement", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode-abonnement"],
    ours: { label: "OpenCode-abonnementer" },
  },
  brand: {
    hero: { copy: { text: "Regler for agent", copied: "Regler kopiert" } },
    naming: {
      title: "Navn",
      body: "Skriv OpenCode som ett ord, med stor O og stor C. Ikke skriv Opencode, Open Code, OpenCode AI eller Open-Code.",
      code: "Bruk `opencode` med små bokstaver bare i kode og pakkenavn, som `opencode-figma` eller `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Logoen alene passer til appikoner, avatarer og andre små flater. De kvadratiske variantene har ekstra luft rundt logoen når bildet beskjæres til et kvadrat.",
        assets: {
          light: { name: "Lys" },
          dark: { name: "Mørk" },
          "square-light": { name: "Kvadratisk, lys" },
          "square-dark": { name: "Kvadratisk, mørk" },
        },
      },
      wordmark: {
        title: "Ordmerke",
        body: "Hele navnet i OpenCodes egen skrift. Bruk ordmerket der det er plass til hele navnet.",
        assets: { light: { name: "Lys" }, dark: { name: "Mørk" } },
      },
      "simple-wordmark": {
        title: "Enkelt ordmerke",
        body: "En ensfarget versjon av ordmerket, for trykk, brodering og steder som bare tillater én farge.",
        assets: { light: { name: "Lys" }, dark: { name: "Mørk" } },
      },
    },
    icons: {
      title: "Avatarer",
      body: "Kvadratiske avatarer på 1024 px for Slack, Discord, GitHub og andre profiler. Bakgrunnen fyller hele kvadratet, og logoen ligger godt innenfor sirkelen, så den ikke blir avskåret ved rund beskjæring.",
      items: { dark: { name: "Mørk" }, light: { name: "Lys" } },
    },
    colors: {
      title: "Farger",
      body: "Logoen og ordmerket bruker én farge med tre grader av dekkevne, og en lysere farge på mørk bakgrunn. Verdiene nedenfor er fargene i standardfilene. Bruk dem bare til logoen og ordmerket, ikke til annen tekst eller bakgrunner. Klikk på en verdi for å kopiere den.",
      palettes: {
        light: {
          name: "Lys",
          swatches: {
            ink: { name: "Farge", use: "Omrisset av logoen og bokstavene i «code»." },
            "ink-70": { name: "Farge 70 %", use: "Bokstavene i «open».", ink: "Fargen med 70 % dekkevne." },
            "ink-20": { name: "Farge 20 %", use: "Den indre skyggen i logoen.", ink: "Fargen med 20 % dekkevne." },
          },
        },
        dark: {
          name: "Mørk",
          swatches: {
            ink: { name: "Farge", use: "Omrisset av logoen og bokstavene i «code»." },
            "ink-72": { name: "Farge 72 %", use: "Bokstavene i «open».", ink: "Fargen med 72 % dekkevne." },
            "ink-28": { name: "Farge 28 %", use: "Den indre skyggen i logoen.", ink: "Fargen med 28 % dekkevne." },
          },
        },
      },
    },
    variants: {
      title: "Varianter",
      body: "Velg versjonen som holder logoen tydelig på bakgrunnen din, altså mørk på lyse bakgrunner og lys på mørke. Logoen og ordmerket er separate filer. Bruk den ene eller den andre.",
      groups: {
        default: {
          name: "Standard",
          body: "Logoen for nesten alle bruksområder. Den indre skyggen er gjennomsiktig. På hvitt eller svart ser den lik ut som varianten med to gråtoner. På bilder, gradienter og fargede flater skinner bakgrunnen gjennom.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Mørk" }, light: { name: "Lys" } } },
            wordmark: { title: "Ordmerke", tiles: { dark: { name: "Mørk" }, light: { name: "Lys" } } },
          },
        },
        simple: {
          name: "Enkel",
          body: "Én farge, med åpne bokstavrom og uten indre skygge. Bruk den på ensfargede bakgrunner, til trykk i én farge og der gråtoner ikke fungerer. Velg den mørke varianten på lyse farger og den lyse på mørke farger.",
          rows: { wordmark: { title: "Ordmerke", tiles: { dark: { name: "Mørk" }, light: { name: "Lys" } } } },
        },
      },
    },
    usage: {
      title: "Bruk",
      body: "Bruk de lyse versjonene på lyse bakgrunner og de mørke versjonene på mørke bakgrunner. Logoen og ordmerket er separate. Bruk den ene eller den andre, ikke begge sammen.",
      stroke: {
        title: "Én strek",
        body: "Avstandsreglene på denne siden måles i streker. Én strek er tykkelsen på logoens omriss, altså en firedel av bredden, så logoen er 4 streker bred og 5 streker høy.",
      },
      clearSpace: {
        title: "Frirom",
        body: "Hold minst to streker avstand på alle sider av logoen og ordmerket. For logoen er en strek tykkelsen på omrisset, en firedel av bredden. For ordmerket er det tykkelsen på bokstavene, en sjudel av høyden.",
      },
      pixels: {
        title: "Hele piksler",
        body: "Logoen har faste proporsjoner på 4:5. Én strek er en firedel av bredden. Skaler logoen i trinn på 4 × 5 px, så alle kanter og streker treffer hele piksler.",
        do: "at hver kant og streken på 4px havner på hele piksler.",
        dont: "å endre proporsjonene fra 4:5. Da havner kantene mellom pikslene og blir uskarpe.",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "Ordmerke" } },
      },
      minimumTitle: "Minimumsstørrelser",
      minimum: {
        logo: { title: "Logo", body: "Minst 16 × 20px, med en strek på 4px. Mindre enn det blir den uskarp." },
        wordmark: {
          title: "Ordmerke",
          body: "Minst 117 × 21px, med en strek på 3px. Mindre enn det blir det uskarpt.",
        },
      },
    },
    donts: {
      title: "Unngå",
      body: "Vanlige feil du bør unngå når du bruker logoen og ordmerket.",
      examples: {
        "two-tone": { caption: "å gi logoen nye farger." },
        bright: { caption: "å bruke én sterk farge." },
        gradient: { caption: "å fylle logoen med en gradient." },
        inverted: { caption: "å bytte om tonene." },
        stretch: { caption: "å strekke eller trykke sammen logoen." },
        shadow: { caption: "å legge til slagskygger." },
        glow: { caption: "å legge til glød eller omriss." },
        lockup: { caption: "å sette andre ord ved siden av logoen." },
        "low-contrast": { caption: "å bruke grått på grått med lav kontrast." },
        color: { caption: "å sette den grå tofargede logoen på en farget bakgrunn, der gråtonene blir grumsete." },
      },
    },
    integrations: {
      title: "Integrasjoner",
      body: "Vis at en plugin, leverandør eller et verktøy fungerer med OpenCode, eller at prosjektet ditt er bygget med det. Bruk et merke eller vis partnerlogoene sammen. Velg et prosjektnavn som gjør det tydelig hvem som står bak.",
      badges: {
        body: "Legg merket i README-filen, i dokumentasjonen eller på nettstedet ditt, og lenk det til opencode.ai. Velg den lyse eller mørke varianten som passer til bakgrunnen. HTML bytter automatisk. Ikke endre fargene eller teksten.",
        sizes: "Alle stiler finnes i 20, 32 og 44 px (Shields bare i 20 px), som SVG og PNG i 2× oppløsning.",
        mono: "Alle filene finnes også med tekst i OpenMono. Legg til -mono før filendelsen, som i opencode-works-with-a-light-20-mono.svg. Bruk -mono-caps for store bokstaver i OpenMono.",
        groups: {
          "works-with": {
            title: "Fungerer med",
            alt: "Fungerer med OpenCode",
            body: "For plugins, leverandører og verktøy som fungerer med OpenCode.",
          },
          "built-with": { title: "Bygget med", alt: "Bygget med OpenCode", body: "For prosjekter laget med OpenCode." },
        },
        styles: { a: { name: "Ramme" }, c: { name: "Celler" }, f: { name: "Helfarge" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "Partnerlogoer",
        body: "Sett OpenCode-logoen og partnerlogoen side om side med et × imellom. La det være 3 streker på hver side av ×. Skaler partnerlogoen så den ser like høy ut som OpenCode-logoen, og hold frirom rundt begge logoene.",
      },
      naming: {
        title: "Navngi prosjektet",
        body: "Start med ditt eget navn, så det er tydelig at prosjektet er ditt.",
        rule: "Skriv `Linear for OpenCode`, eller gi pakken navnet `opencode-linear`. Ikke skriv `OpenCode Linear` eller `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Varemerker",
      body: "OpenCode og OpenCode-logoen er varemerker som tilhører Anomaly. Uten tillatelse kan du ikke bruke dem til å antyde at Anomaly støtter eller sponser deg, i produkt- eller firmanavnet ditt eller på profilartikler.",
      contact: { before: "Send spørsmål til " },
    },
  },
  press: {
    title: "OpenCode | Pressepakke med selskapsfakta og merkefiler",
    description:
      "Pressepakken inneholder fakta om OpenCode og selskapet bak, Anomaly. Her kan du laste ned logoer og ordmerker og finne kontaktinformasjon for pressen.",
    hero: {
      title: "Presse",
      body: "Fakta, merkefiler og kontaktinformasjon for deg som skriver om OpenCode og Anomaly.",
    },
    company: {
      title: "Om Anomaly",
      lead: "Anomaly er selskapet bak OpenCode. Det lager verktøy med åpen kildekode for utviklere.",
      more: "Andre prosjekter er blant annet SST og OpenTUI, alle med åpen kildekode på [GitHub](github).",
      learnMore: "Les mer på [anoma.ly](site).",
      projects: {
        opencode: {
          body: "Kodingsagenten med åpen kildekode. Tilgjengelig som desktop-app, terminalgrensesnitt, mobilapp og SDK. MIT-lisensiert, over 220 000 GitHub-stjerner.",
        },
        sst: {
          body: "Et rammeverk for å bygge fullstack-apper på din egen infrastruktur. MIT-lisensiert, åpent siden 2020, med over 26 000 GitHub-stjerner.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Et bibliotek for terminalgrensesnitt i TypeScript, React eller Solid, med en kjerne i Zig. OpenCode bruker det i produksjon. Over 13 000 GitHub-stjerner.",
        },
        "models-dev": {
          body: "En database med åpen kildekode over spesifikasjoner, priser og egenskaper for AI-modeller, med et offentlig API. Den har over 8 900 modeller fra over 200 leverandører.",
        },
        hex: {
          body: "Diktering for Mac, Windows og Linux. Hex transkriberer på enheten og limer inn teksten i hvilken som helst app, uten at lyden forlater enheten.",
        },
        opentunnel: {
          body: "En CLI og et SDK som gir apper på maskinen din en offentlig HTTPS-URL. TLS termineres på maskinen din, så reléet aldri ser klartekst.",
        },
      },
    },
    about: {
      title: "Om OpenCode",
      body: "Beskrivelser av OpenCode og produktene i lang og kort versjon, klare til å kopieres.",
      boilerplate: {
        long: "OpenCode er en kodingsagent med åpen kildekode. Den finnes som desktop-app, terminalgrensesnitt, mobilapp og SDK, og fungerer med modeller fra alle leverandører, blant annet Claude, GPT og Gemini. OpenCode er MIT-lisensiert og laget av Anomaly. Prosjektet har over 220 000 GitHub-stjerner og mer enn 1 000 bidragsytere. Over 22 millioner utviklere bruker OpenCode hver måned.",
        short:
          "OpenCode er en kodingsagent med åpen kildekode fra Anomaly. Den finnes som desktop-app, terminalgrensesnitt, mobilapp og SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console er nettappen der utviklere og team kjøper og administrerer tilgang til AI-modeller for OpenCode og andre kodingsagenter. Du kan betale for inferens per forespørsel med forhåndsbetalt kreditt, både for de fremste modellene og modeller med åpne vekter. Du kan også abonnere på OpenCode Go. Team får arbeidsområder med rollene Member, Admin og Owner, forbruksgrenser for hele arbeidsområdet og per bruker, felles pålogging med Okta, Microsoft Entra ID eller Google Workspace og støtte for SCIM. Console støtter mer enn 30 leverandører, så du kan koble til kontoer teamet allerede har. Du velger selv om du vil bruke inferens fra OpenCode. Du finner Console på opencode.ai/console.",
          short:
            "OpenCode Console er nettappen fra Anomaly der du kan betale for AI-modeller etter bruk, abonnere på OpenCode Go og styre teamet med blant annet budsjetter og felles pålogging.",
        },
        "opencode-go": {
          long: "OpenCode Go er et abonnement for utviklere som vil ha en fast månedspris for kodemodeller. Go koster $10/måned, Go Plus koster $40/måned og gir høyere grenser, og Go Teams koster $20/måned per medlem. Hvert abonnement gir tilgang til utvalgte modeller testet for agentbasert koding. Hver modell har en månedlig bruksgrense i dollar, med rullerende kvoter på 20 % av månedsgrensen per 5 timer og 50 % per uke. Du kan fylle på kreditt, betale fra saldoen når kvoten er brukt opp og si opp når som helst. Go fungerer med OpenCode og andre agenter. Du finner det på opencode.ai/console/go.",
          short:
            "OpenCode Go er et abonnement fra Anomaly med månedlige brukskvoter for utvalgte kodemodeller, fra $10/måned.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data er et offentlig dashbord som viser hvilke AI-modeller utviklere bruker i OpenCode, og hvordan fordelingen endrer seg over tid. Det viser en toppliste over modeller, tokenbruk, kostnader per økt og token, forholdstall for promptcachen, markedsandeler og fordeling etter land. Tallene summeres hver time, og døgn og uker følger UTC. Antall brukere og økter er omtrentlige, og kostnadene beregnes ut fra listeprisene i modellkatalogen til OpenCode. Journalister kan sitere OpenCode Data (opencode.ai/data) og oppgi oppdateringstidspunktet som står på siden.",
          short:
            "OpenCode Data er et offentlig dashbord på opencode.ai/data som rangerer AI-modeller etter faktisk bruk i OpenCode, med tokens, kostnader og markedsandeler, oppdatert hver time.",
        },
      },
    },
    facts: {
      title: "Kort fortalt",
      items: {
        license: { label: "Lisens" },
        "first-release": { label: "Første utgivelse" },
        "made-by": { label: "Laget av" },
      },
    },
    milestones: {
      title: "Milepæler",
      items: {
        "first-release-v0-0-1": { date: "apr. 2025", text: "Første utgivelse, v0.0.1" },
        "1-million-downloads": { date: "okt. 2025", text: "Over 1 million nedlastinger" },
        "opencode-1-0": { date: "okt. 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "des. 2025", text: "Desktop-appen lanseres" },
        "10-million-downloads": { date: "jan. 2026", text: "Over 10 mill. nedlastinger" },
        "opencode-2-0": { date: "sep. 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "nov. 2026", text: "Over 220 000 GitHub-stjerner" },
      },
    },
    news: {
      title: "Siste utgivelser",
      intro: "OpenCode kommer ofte med nye versjoner. Dette er de nyeste utgivelsene med nye funksjoner.",
      changelog: { text: "Hele endringsloggen" },
      feed: { text: "RSS-feed" },
    },
    media: {
      title: "Medier",
      intro:
        "Stillbilder og korte opptak fra hver app. Bruk dem gjerne når du skriver om OpenCode.",
      note: "Alle opptak er gjort i mørkt tema. Stillbilder og forhåndsvisningsbilder er JPG-filer opptil 1920 × 1080, eller 1080 × 1350 i stående format. Videoene er lydløse MP4-klipp.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-film" },
            "frame-1": { title: "Desktop-bilde 1" },
            "frame-2": { title: "Desktop-bilde 2" },
            "frame-3": { title: "Desktop-bilde 3" },
            "frame-4": { title: "Desktop-bilde 4" },
            "feature-1": { title: "Parallelle agenter" },
            "feature-2": { title: "Se det i nettleseren" },
            "feature-3": { title: "På alle enheter" },
            "locked-portrait": { title: "Desktop-film, stående" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile-film" },
            "frame-1": { title: "Mobile-bilde 1" },
            "frame-2": { title: "Mobile-bilde 2" },
            "frame-3": { title: "Mobile-bilde 3" },
            "feature-1": { title: "Stemme" },
            "feature-2": { title: "Økter" },
            "feature-3": { title: "Resultater" },
            "locked-portrait": { title: "Mobile-film, stående" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal-film" },
            "frame-1": { title: "Terminal-bilde 1" },
            "frame-2": { title: "Terminal-bilde 2" },
            "frame-3": { title: "Terminal-bilde 3" },
            "frame-4": { title: "Terminal-bilde 4" },
            "feature-1": { title: "Spør med egne ord" },
            "feature-2": { title: "Godkjenn før kjøring" },
            "feature-3": { title: "Gjør det til ditt" },
            "locked-portrait": { title: "Terminal-film, stående" },
          },
        },
        sdk: {
          items: {
            "locked-landscape": { title: "SDK-film" },
            "frame-1": { title: "SDK-bilde 1" },
            "frame-2": { title: "SDK-bilde 2" },
            "frame-3": { title: "SDK-bilde 3" },
            "frame-4": { title: "SDK-bilde 4" },
            "feature-1": { title: "Fiks CI fra kode" },
            "feature-2": { title: "Følg hvert steg" },
            "feature-3": { title: "Lag egne verktøy" },
            "locked-portrait": { title: "SDK-film, stående" },
          },
        },
      },
    },
    people: { title: "Personer" },
    anomalyLogo: {
      title: "Anomaly-logo",
      body: "Anomaly-merket og ordmerket i svart og hvitt. PNG-ene er 2048 px brede.",
      assets: {
        "mark-black": { name: "Merke, svart" },
        "mark-white": { name: "Merke, hvitt" },
        "wordmark-black": { name: "Ordmerke, svart" },
        "wordmark-white": { name: "Ordmerke, hvitt" },
      },
      avatars: {
        body: "Kvadratiske avatarer for X, GitHub, Slack, LinkedIn og andre profiler. Merket sitter godt innenfor sirkelen, så det tåler en rund beskjæring. PNG-ene er 1024 og 400 px brede.",
        items: {
          "avatar-dark": { name: "Avatar, mørk" },
          "avatar-light": { name: "Avatar, lys" },
        },
      },
      all: { text: "Last ned alt" },
    },
    coverage: { title: "Omtale" },
    brand: {
      title: "Merkevare",
      before:
        "Last ned OpenCode-logoene og -ordmerkene i én ZIP-fil. Enkeltfiler, varianter og regler for bruk finner du på ",
      link: { text: "merkevaresiden" },
      usage:
        "Du kan bruke disse filene når du skriver om OpenCode. Ikke endre dem, og ikke antyd at OpenCode støtter arbeidet ditt.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Kjør flere agenter samtidig, hver i sin egen fane, på macOS, Windows og Linux. Gå gjennom hver endring som en diff og forhåndsvis den.",
        },
        mobile: {
          name: "Mobile",
          body: "Den nyeste OpenCode-appen. Ring agenten i en økt, gå gjennom endringene og godkjenn dem fra telefonen, uansett hvor du er.",
        },
        terminal: {
          name: "Terminal",
          body: "Et terminalgrensesnitt som fungerer i alle shell, editorer og eksterne servere. Se hver endring som en diff, og velg hvilke terminalkommandoer som skal kjøre automatisk.",
        },
        sdk: {
          body: "En typesikker TypeScript-klient for skript, CI-jobber og egne verktøy. Opprett økter, send prompter og strøm alle hendelser idet de skjer.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: {
          title: "Presse",
          body: "For journalister og analytikere. Vi svarer bare på henvendelser fra mediene.",
        },
        support: {
          title: "Hjelp",
          body: "Trenger du hjelp med OpenCode, kan du opprette en sak eller spørre fellesskapet. Send oss en e-post hvis det gjelder konto eller fakturering.",
          links: { "github-issues": { text: "GitHub-issues" }, "help-anoma-ly": { text: "help@anoma.ly" } },
        },
        security: {
          title: "Sikkerhet",
          body: "Rapporter en sårbarhet via GitHub. Send oss en e-post hvis ingen svarer innen 6 virkedager.",
          links: {
            "report-a-vulnerability": { text: "Rapporter en sårbarhet" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "Skript" } } },
    extensions: {
      title: "Utvidelser",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "Skript" } } },
    sdk: { more: { label: "Les SDK-dokumentasjonen" } },
    mini: {
      commands: { curl: { name: "Skript" } },
      lead: "Mini følger med OpenCode CLI. Installer den på en av disse måtene, og kjør så opencode mini.",
    },
  },
  pair: {
    title: "Koble til telefonen",
    cardTitle: "Koble til telefonen med én kommando",
    intro:
      "OpenCode Mobile er fjernkontrollen til OpenCode på datamaskinen din. Øktene kjører videre der, mens du følger og styrer dem i appen.",
    steps: {
      "get-the-app": {
        title: "Installer appen",
        body: "Installer OpenCode-betaen via TestFlight på iPhone, eller installer appen på Android.",
      },
      "run-this-on-your-computer": {
        title: "Kjør dette på datamaskinen",
        body: "Kommandoen viser en engangslenke og en QR-kode. De kan bare brukes én gang og utløper etter 5 minutter.",
      },
      "scan-the-code": {
        title: "Skann koden",
        body: "Skann QR-koden i appen eller lim inn lenken. Da vises de siste øktene fra datamaskinen på telefonen.",
      },
    },
    note: "--remote kobler til via en OpenTunnel-adresse, så det fungerer fra hvilket som helst nettverk. På samme Wi-Fi kjører du opencode service set hostname 0.0.0.0 én gang og deretter opencode pair.",
    facts: [
      "Tilkoblingen fungerer fra alle nettverk fordi --remote bruker en OpenTunnel-adresse.",
      "Lenken og koden virker én gang og utløper etter 5 minutter.",
      "La datamaskinen være på, for agenten kjører der og ikke på telefonen.",
      "På samme Wi-Fi kjører du opencode service set hostname 0.0.0.0 én gang og deretter opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Lag, installer og del plugins for Desktop.",
      link: "Se nytt i 2.2",
    },
    "desktop-terminals-now-survive-restarts": { text: "Terminaler i Desktop fortsetter nå etter omstart.", link: "Se v2.2.4" },
    "agents-can-now-generate-images": { text: "Agenter kan nå lage bilder.", link: "Se v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "Styr øktene dine fra telefonen.", link: "Se OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "Desktop-appen i ny drakt.", link: "Se nytt i 2.2" },
  },
} satisfies ContentOverlay
