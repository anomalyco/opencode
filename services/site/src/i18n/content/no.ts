import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sesjoner, faner, differ, innebygd nettleser og utvidelser på macOS, Windows og Linux.",
      action: "Last ned",
    },
    mobile: {
      name: "Mobile",
      body: "Start, styr og godkjenn sesjoner fra telefonen, uansett hvor du er.",
      action: "Last ned",
    },
    terminal: {
      name: "Terminal",
      body: "Et raskt terminalgrensesnitt som fungerer i alle skall, editorer og eksterne servere.",
      action: "Installer",
    },
    sdk: { body: "Styr OpenCode fra dine egne skript, CI-jobber og verktøy.", action: "Les docs" },
    ide: {
      name: "IDE-utvidelser",
      body: "Åpne OpenCode i VS Code, Cursor og Windsurf, eller i Zed og JetBrains-IDE-er via ACP.",
      action: "Installer",
    },
    mini: {
      body: "Et minimalt terminalgrensesnitt. Svarene skrives inn i scrollbacken din, med én prompt under.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Skrivebordsapp for macOS, Windows og Linux",
      description:
        "Kjør så mange OpenCode-agenter du vil parallelt, se hver endring i en nettleser ved siden av og fortsett på hvilken som helst enhet. For macOS, Windows og Linux.",
      intro:
        "Kjør flere agenter samtidig, hver sesjon i sin egen fane. Gå gjennom hver endring som en diff, kommenter hvilken som helst linje og sjekk resultatet i den innebygde nettleseren. For macOS, Windows og Linux.",
      showcase: {
        "parallel-agents": {
          title: "Parallelle agenter",
          body: "Start så mange agenter du vil, og la dem alle jobbe parallelt. Bytt mellom dem etter hvert som de blir ferdige.",
        },
        "see-it-in-the-browser": {
          title: "Se det i nettleseren",
          body: "Appen din åpnes i en nettleser ved siden av agenten, så dere begge ser hver endring komme inn.",
        },
        "on-every-device": {
          title: "På alle enheter",
          body: "Start agenter på alle enhetene dine, og fortsett i desktop-appen, terminalen eller på telefonen.",
        },
        "extend-it": {
          title: "Utvid den",
          body: "Koble til verktøyene og tjenestene dine så agenten kan jobbe med hva som helst. Eller la OpenCode bygge plugins til seg selv, med eget grensesnitt i sidepanelet.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, kodesesjonene dine på telefonen",
      description:
        "Start og styr OpenCode-økter fra telefonen. Snakk med agenten mens den kjører på datamaskinen din.",
      intro:
        "Start og styr økter fra telefonen, uansett hvor du er. Ring en økt og snakk med agenten, eller åpne en økt og fortsett der du slapp, alt med OpenCode på din egen datamaskin.",
      features: {
        "notify-when-done": {
          title: "Varsel når ferdig",
          body: "Få et kort sammendrag når en sesjon du startet, er ferdig.",
        },
        "pair-from-anywhere": {
          title: "Koble fra overalt",
          body: "Koble til fra hvilket som helst nettverk med opencode pair --remote.",
        },
        "every-computer": {
          title: "Alle maskiner",
          body: "Bytt mellom datamaskinene du har koblet til, med ett trykk.",
        },
        "siri-and-shortcuts": {
          title: "Siri og Snarveier",
          body: "Start en samtale eller en sesjon fra Siri eller Kontrollsenter.",
        },
        "follow-along": { title: "Følg med", body: "Se tidslinjen oppdatere seg mens agenten jobber." },
        "your-computer": { title: "Din datamaskin", body: "Kobler til OpenCode som kjører på din egen maskin." },
        "share-sheet": { title: "Delingsark", body: "Del hva som helst til en sesjon uten å åpne appen." },
        "mute-sessions": { title: "Demp sesjoner", body: "Behold en sesjon i listen uten å få varslene fra den." },
      },
      showcase: {
        voice: { title: "Stemme", body: "Ring en sesjon og si hva du trenger. Agenten svarer høyt." },
        sessions: { title: "Sesjoner", body: "Åpne en sesjon for å se hvor den står, og fortsett der du slapp." },
        steer: { title: "Styr", body: "Send en oppfølging for å endre retning midt i sesjonen." },
        results: { title: "Resultater", body: "Samtalen forteller deg hva som er endret når arbeidet er ferdig." },
      },
    },
    terminal: {
      title: "OpenCode | Terminal-UI for kodeagenten med åpen kildekode",
      description:
        "Et raskt terminalgrensesnitt for OpenCode som fungerer i alle skall, editorer og eksterne servere. Beskriv hva du vil, se hver endring som en diff og godkjenn kommandoer.",
      intro:
        "Et raskt terminalgrensesnitt som fungerer i alle skall, editorer og eksterne servere. Beskriv med vanlige ord hva du vil, se hver endring komme som en diff, og velg hvilke kommandoer som kjører av seg selv.",
      features: {
        "any-terminal": {
          title: "Alle terminaler",
          body: "Fungerer i alle skall, i terminalen i editoren din eller på en ekstern server.",
        },
        "diffs-in-the-timeline": {
          title: "Differ i tidslinjen",
          body: "Se hver endring som en diff i tidslinjen mens agenten gjør den.",
        },
        "pick-up-later": {
          title: "Fortsett senere",
          body: "Fortsett den siste sesjonen med -c, eller en hvilken som helst med -s.",
        },
        "one-off-runs": { title: "Enkeltkjøringer", body: "opencode run sender én melding og skriver ut svaret." },
        "agents-and-commands": {
          title: "Agenter og kommandoer",
          body: "Bytt agent med shift+tab og åpne alle kommandoer med ctrl+p.",
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
          title: "Godkjenn det som kjører",
          body: "Endringer vises som differ, og kommandoer venter på tillatelsen din.",
        },
        "make-it-yours": {
          title: "Gjør det til ditt",
          body: "Bytt tema med ett tastetrykk, fra standard til tokyonight og flere.",
        },
        mini: { title: "Mini", body: "Kjør opencode mini, så skrives svarene inn i din egen scrollback." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK for skript, CI-jobber og verktøy",
      description:
        "Styr OpenCode fra dine egne skript, CI-jobber og verktøy. Den typede TypeScript-klienten oppretter sesjoner, sender prompter og strømmer alle hendelser idet de skjer.",
      intro:
        "Styr OpenCode fra dine egne skript, CI-jobber og verktøy. SDK-et kjører OpenCode i din egen prosess, med konfigurasjonen og modellene dine, og den typede klienten oppretter sesjoner, sender prompter og strømmer alle hendelser.",
      features: {
        "typescript-client": {
          title: "TypeScript-klient",
          body: "Typede forespørsler og hendelser, med de samme verdiene som @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sesjoner fra kode",
          body: "Opprett sesjoner og send prompter fra et hvilket som helst skript.",
        },
        "any-model": { title: "Alle modeller", body: "Bruker modellene OpenCode-oppsettet ditt har." },
        "npm-or-bun": {
          title: "npm eller bun",
          body: "Installer med npm i @opencode/sdk eller bun add @opencode/sdk.",
        },
        "in-process-host": { title: "In-process-vert", body: "Kjører OpenCode i minnet, uten nettverkshopp." },
        "your-plugins": { title: "Dine plugins", body: "Send inn egne plugins når du oppretter in-process-verten." },
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
          body: "Strøm hendelser for å se hvert verktøy agenten kaller, idet det skjer.",
        },
        "build-your-own-tools": {
          title: "Lag egne verktøy",
          body: "Koble OpenCode inn i boter, dashbord og arbeidsflyter med noen få linjer.",
        },
        "in-your-process": {
          title: "I prosessen din",
          body: "Kjører OpenCode i prosessen din, med konfigurasjonen og modellene dine.",
        },
      },
    },
    ide: {
      title: "OpenCode | Editorintegrasjoner for VS Code, Cursor og Zed",
      description:
        "Bruk OpenCode i editoren din, med utvidelsen for VS Code, Cursor, Windsurf og VSCodium, og opencode acp for Zed, JetBrains-IDE-er og andre ACP-editorer.",
      intro:
        "Bruk OpenCode i editoren din. I VS Code, Cursor, Windsurf og VSCodium kjører du opencode i den integrerte terminalen, så installerer utvidelsen seg selv. Zed, JetBrains-IDE-er og andre editorer som støtter Agent Client Protocol, kjører OpenCode med opencode acp.",
      features: {
        "quick-launch": { title: "Hurtigstart", body: "Cmd+Esc eller Ctrl+Esc åpner OpenCode i en delt terminal." },
        "new-session": { title: "Ny sesjon", body: "Cmd+Shift+Esc eller Ctrl+Shift+Esc starter en ny sesjon." },
        context: { title: "Kontekst", body: "Deler gjeldende utvalg eller fane med OpenCode." },
        "file-references": { title: "Filreferanser", body: "Cmd+Option+K eller Alt+Ctrl+K setter inn @File#L37-42." },
        "installs-itself": {
          title: "Installerer seg",
          body: "Kjør opencode i den integrerte terminalen for å legge den til.",
        },
        "acp-editors": { title: "ACP-editorer", body: "Zed, JetBrains-IDE-er, Avante.nvim og CodeCompanion.nvim." },
        "open-vsx": { title: "Open VSX", body: "Også på Open VSX for Cursor, Windsurf og VSCodium." },
        "same-agent": { title: "Samme agent", body: "OpenCode du kjører i terminalen, ved siden av koden din." },
      },
    },
    mini: {
      title: "OpenCode | Mini, et minimalt terminalgrensesnitt for agenten",
      description:
        "Mini kjører OpenCode i et minimalt terminalgrensesnitt. Svarene skrives inn i terminalens egen scrollback, og bare en prompt og en statuslinje blir igjen nederst.",
      intro:
        "Et minimalt terminalgrensesnitt for OpenCode. Kjør opencode mini, så skrives svarene rett inn i terminalens egen scrollback, og du kan rulle, søke og kopiere dem som all annen utdata. Bare prompten og en statuslinje blir igjen nederst.",
      features: {
        "your-scrollback": { title: "Din scrollback", body: "Svarene blir vanlig terminalhistorikk." },
        "one-prompt": { title: "Én prompt", body: "Agent, modell, kontekst og kostnad på én statuslinje." },
        permissions: { title: "Tillatelser", body: "Tillat endringer og kommandoer fra promptområdet." },
        "how-much-shows": {
          title: "Hvor mye du ser",
          body: "Stille, standard eller alt, for tenkning og verktøyutdata.",
        },
        "pick-up-later": {
          title: "Fortsett senere",
          body: "Fortsett den siste sesjonen med -c, eller en hvilken som helst med -s.",
        },
        "same-opencode": { title: "Samme OpenCode", body: "Samme server, agenter og modeller som de andre appene." },
        agents: { title: "Agenter", body: "Bytt agent rett fra prompten." },
        compact: { title: "Kompakt", body: "Krymp en lang sesjon med /compact." },
      },
    },
  },
  extensionCard: {
    name: "Utvidelser",
    body: "Bruk OpenCode i VS Code, eller i Zed og andre editorer via ACP.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "La agenter bruke den ekte nettleseren din.",
      title: "OpenCode | Browse, den ekte nettleseren din for kodeagenter",
      description:
        "Browse lar OpenCode og andre MCP-klienter bruke den ekte nettleseren din. Agenter styrer faner i bakgrunnen med Playwright og gir innlogging og 2FA tilbake til deg.",
      intro:
        "En MCP-server og en Chromium-utvidelse som lar agentene dine bruke den ekte nettleseren din, med fanene, innloggingene og utvidelsene dine. De åpner og styrer faner med Playwright, tar skjermbilder og tar opp skjermen, i bakgrunnsfaner som er gruppert og ute av veien. Når det er din tur, for en innlogging, en 2FA-forespørsel eller en betaling, gir de fanen tilbake til deg og fortsetter når du klikker på Continue.",
      features: {
        "your-real-browser": {
          title: "Din ekte nettleser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera og Chromium.",
        },
        "out-of-your-way": { title: "Ute av veien", body: "Agentfaner åpnes i bakgrunnen, i sammenslåtte grupper." },
        handoffs: { title: "Din tur", body: "Ta innloggingen eller 2FA selv, og klikk så på Continue." },
        "lend-a-tab": {
          title: "Lån ut fane",
          body: "Klikk på knappen i verktøylinjen for å gi en agent en åpen fane.",
        },
        "record-and-capture": {
          title: "Ta opp og lagre",
          body: "Skjermbilder, skjermopptak og nettverkstrafikk som HAR.",
        },
        "any-mcp-client": {
          title: "Alle MCP-klienter",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed og mange flere.",
        },
        "named-sessions": {
          title: "Navngitte sesjoner",
          body: "Hver sesjon beholder sine egne faner, også etter omstart.",
        },
        allowlists: { title: "Hvitelister", body: "Begrens fanene til en sesjon til nettstedene du oppgir." },
      },
      install:
        "Én linje installerer Browse, legger det til i agentene den finner og kobler til utvidelsen. På Windows kjører du irm https://opencode.ai/browse/install.ps1 | iex. Eller be agenten din sette det opp.",
    },
  },
  apps: {
    opentunnel: { category: "Lokale tunneler", body: "Offentlige HTTPS-URL-er for lokale apper." },
    opentui: { category: "Bibliotek", body: "Et bibliotek for terminalgrensesnitt." },
    hex: { category: "Diktering", body: "Diktering rett på enheten for alle apper." },
  },
  getStarted: {
    title: "Kom i gang",
    lead: "Den enkleste måten å starte på er å laste ned OpenCode og bruke de gratis modellene. Ingen konto trengs. Vil du ha mer, kan du ta med ditt eget abonnement eller bruke OpenCode Go.",
    phrases: {
      "download-opencode": { text: "laste ned OpenCode" },
      "free-models": { text: "gratis modellene" },
      "your-own-subscription": { text: "ditt eget abonnement" },
      "a-subscription-you-already-have": { text: "et abonnement du allerede har" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "Last ned", line: "Desktop, mobil eller terminal." },
      "use-free-models": {
        title: "Bruk gratis modeller",
        line: "OpenCode har et sett gratis modeller. Ingen konto trengs.",
      },
      "add-more-models": {
        title: "Flere modeller",
        line: "Ta med ditt eget abonnement, eller bruk de utvalgte modellene i OpenCode Go fra $10/mnd.",
      },
    },
    sentence:
      "Last ned OpenCode, start med gratis modeller, og ta med ditt eget abonnement eller OpenCode Go når du vil ha mer.",
  },
  byos: {
    title: "Ta med eget abonnement",
    headline: "Bruk abonnementene du allerede har.",
    line: "Logg inn med ChatGPT Plus eller Pro eller med GitHub Copilot. Eller bruk et OpenCode-abonnement.",
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
        body: "Logoen alene, for appikoner, avatarer og andre små flater. De kvadratiske versjonene har ekstra luft for steder som beskjærer til et kvadrat.",
        assets: {
          light: { name: "Lys" },
          dark: { name: "Mørk" },
          "square-light": { name: "Kvadratisk, lys" },
          "square-dark": { name: "Kvadratisk, mørk" },
        },
      },
      wordmark: {
        title: "Ordmerke",
        body: "Hele navnet i OpenCode-bokstavformene. Bruk det der det er plass til å skrive ut navnet.",
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
      body: "Kvadratiske avatarer på 1024px for Slack, Discord, GitHub og andre profiler. Bakgrunnen fyller hele kvadratet, og logoen sitter godt innenfor sirkelen, så de tåler en rund beskjæring.",
      items: { dark: { name: "Mørk" }, light: { name: "Lys" } },
    },
    colors: {
      title: "Farger",
      body: "Logoen og ordmerket bruker én farge i tre opasiteter, med en lysere farge for mørke bakgrunner. Verdiene under er fargen over hvitt eller #0B0B0B, slik standardfilene viser den. Klikk på en verdi for å kopiere den.",
      palettes: {
        light: {
          name: "Lys",
          swatches: {
            ink: { name: "Farge", use: "Omrisset av logoen og bokstavene i «code»." },
            "ink-70": { name: "Farge 70%", use: "Bokstavene i «open».", ink: "Fargen med 70% opasitet." },
            "ink-20": { name: "Farge 20%", use: "Den indre skyggen i logoen.", ink: "Fargen med 20% opasitet." },
          },
        },
        dark: {
          name: "Mørk",
          swatches: {
            ink: { name: "Farge", use: "Omrisset av logoen og bokstavene i «code»." },
            "ink-72": { name: "Farge 72%", use: "Bokstavene i «open».", ink: "Fargen med 72% opasitet." },
            "ink-28": { name: "Farge 28%", use: "Den indre skyggen i logoen.", ink: "Fargen med 28% opasitet." },
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
          body: "Logoen du bruker nesten overalt. Den indre skyggen er gjennomsiktig. På hvitt eller svart ser den nøyaktig ut som de tofargede gråtonene, og på bilder, gradienter og farger skinner bakgrunnen gjennom.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Mørk" }, light: { name: "Lys" } } },
            wordmark: { title: "Ordmerke", tiles: { dark: { name: "Mørk" }, light: { name: "Lys" } } },
          },
        },
        simple: {
          name: "Enkel",
          body: "Én farge, med åpne punsjer og uten indre skygge. Bruk den på ensfargede bakgrunner, for trykk i én farge og overalt der du ikke kan bruke gråtonene, enkel mørk på lyse farger og enkel lys på mørke farger.",
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
        body: "Proporsjonene til logoen er låst til 4:5, og én strek er en firedel av bredden. Skaler den i steg på 4 × 5px, så hver kant og hver strek havner på en hel piksel.",
        do: "at hver kant og streken på 4px havner på hele piksler.",
        dont: "å gi logoen andre proporsjoner enn 4:5, ellers havner kantene mellom piksler og blir uskarpe.",
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
        "two-tone": { caption: "å fargelegge logoen i nye farger." },
        bright: { caption: "å bruke én sterk farge." },
        gradient: { caption: "å fylle logoen med en gradient." },
        inverted: { caption: "å bytte om tonene." },
        stretch: { caption: "å strekke eller klemme logoen." },
        shadow: { caption: "å legge til skygger." },
        glow: { caption: "å legge til glød eller omriss." },
        lockup: { caption: "å sette andre ord ved siden av logoen." },
        "low-contrast": { caption: "å bruke grått på grått med lav kontrast." },
        color: { caption: "å sette den grå tofargede logoen på en farget bakgrunn, der gråtonene blir grumsete." },
      },
    },
    integrations: {
      title: "Integrasjoner",
      body: "Plugins, leverandører og verktøy som fungerer med OpenCode, og prosjekter som er bygget med det, kan si det. Bruk et merke eller en partnerlockup, og gi prosjektet et navn som gjør det tydelig at det er ditt.",
      badges: {
        body: "Sett et merke i README-en, dokumentasjonen eller på nettstedet ditt, og lenk det til opencode.ai. Velg den lyse eller mørke filen for bakgrunnen din (HTML-en bytter av seg selv), og ikke endre fargene eller teksten.",
        sizes: "Alle stiler finnes i 20, 32 og 44px (Shields bare i 20px), som SVG og som PNG i 2×.",
        mono: "Hver fil finnes også med tekst i OpenTUI Mono. Legg til -mono før filtypen, som i opencode-works-with-a-light-20-mono.svg, eller -mono-caps for OpenTUI Mono med store bokstaver.",
        groups: {
          "works-with": {
            title: "Virker med",
            alt: "Virker med OpenCode",
            body: "For plugins, leverandører og verktøy som kjører med OpenCode.",
          },
          "built-with": { title: "Bygget med", alt: "Bygget med OpenCode", body: "For prosjekter laget med OpenCode." },
        },
        styles: { a: { name: "Ramme" }, c: { name: "Celler" }, f: { name: "Helfarge" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "Partnerlockup",
        body: "Sett OpenCode-logoen og partnerlogoen side om side, med en × mellom. Hold 3 streker avstand på hver side av ×, skaler partnerlogoen så den ser like høy ut som OpenCode-logoen, og hold frirom rundt hele lockupen.",
      },
      naming: {
        title: "Navngi prosjektet",
        body: "Start med ditt eget navn, så det er tydelig at prosjektet er ditt.",
        rule: "Skriv `Linear for OpenCode`, eller gi pakken navnet `opencode-linear`. Ikke skriv `OpenCode Linear` eller `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Varemerker",
      body: "OpenCode og OpenCode-logoen er varemerker som tilhører Anomaly. Ikke bruk dem til å antyde at Anomaly støtter eller sponser deg, i produkt- eller firmanavnet ditt eller på merchandise uten tillatelse.",
      contact: { before: "Spørsmål kan sendes til " },
    },
  },
  press: {
    title: "OpenCode | Pressesett med fakta om selskapet og merkevareressurser",
    description:
      "Pressesettet til OpenCode, med fakta om OpenCode og Anomaly, selskapet bak, logoer og ordmerker å laste ned og en kontakt for spørsmål fra pressen.",
    hero: {
      title: "Presse",
      body: "Fakta, merkevareressurser og kontakter for deg som skriver om OpenCode og Anomaly.",
    },
    company: {
      title: "Om Anomaly",
      lead: "Anomaly er selskapet bak OpenCode. Det lager verktøy med åpen kildekode for utviklere.",
      more: "Andre prosjekter er blant annet SST og OpenTUI, alle med åpen kildekode på [GitHub](github).",
      learnMore: "Les mer på [anoma.ly](site).",
      projects: {
        opencode: {
          body: "Kodeagenten med åpen kildekode, med apper for skrivebord, mobil og terminal og et SDK. MIT-lisensiert, over 220 000 GitHub-stjerner.",
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
          body: "Diktering for Mac, Windows og Linux. Hex transkriberer på enheten din og limer inn i hvilken som helst app, så lyden aldri forlater den.",
        },
        opentunnel: {
          body: "En CLI og et SDK som gir apper på maskinen din en offentlig HTTPS-URL. TLS termineres på maskinen din, så reléet aldri ser klartekst.",
        },
      },
    },
    about: {
      title: "Om OpenCode",
      boilerplate: {
        long: "OpenCode er en kodeagent med åpen kildekode. Den finnes som skrivebordsapp, mobilapp, terminal-UI og SDK, og fungerer med modeller fra alle leverandører, blant annet Claude, GPT og Gemini. OpenCode er MIT-lisensiert og laget av Anomaly. Den har over 220 000 GitHub-stjerner og mer enn 1 000 bidragsytere, og over 22 millioner utviklere bruker den hver måned.",
        short:
          "OpenCode er en kodeagent med åpen kildekode fra Anomaly, med apper for skrivebord, mobil og terminal og et SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console er nettappen der utviklere og team kjøper og administrerer tilgang til AI-modeller for OpenCode og andre kodeagenter. Den tilbyr betal-etter-bruk-inferens for frontier- og open weight-modeller, belastet per forespørsel fra forhåndsbetalt kreditt, og abonnementer på OpenCode Go. Team får arbeidsområder med rollene Member, Admin og Owner, forbruksgrenser for arbeidsområdet og per bruker, single sign-on med Okta, Microsoft Entra ID eller Google Workspace, og SCIM. Console støtter mer enn 30 leverandører, så team kan koble til leverandørkontoer de allerede har, og den egne inferensen er valgfri. Den finnes på opencode.ai/console.",
          short:
            "OpenCode Console er nettappen fra Anomaly for betal-etter-bruk-tilgang til AI-modeller, abonnementer på OpenCode Go og teamkontroller som budsjetter og single sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go er et abonnement for utviklere som vil ha en fast månedspris for kodemodeller. Go koster $10/mnd., Go Plus koster $40/mnd. med høyere grenser, og Go Teams koster $20/mnd. per medlem. Hvert abonnement har et utvalg modeller som er testet for agentisk koding. Bruksgrensene er månedlige dollarbeløp for hver modell, med rullerende kvoter for 5 timer og en uke på 20% og 50% av månedsgrensen. Abonnenter kan fylle på kreditt, falle tilbake på en betal-etter-bruk-saldo og si opp når som helst. Go fungerer med OpenCode og andre agenter. Det finnes på opencode.ai/console/go.",
          short:
            "OpenCode Go er et månedsabonnement fra Anomaly som gir utviklere månedlige bruksgrenser på et utvalg kodemodeller, fra $10/mnd.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data er et offentlig dashbord som viser hvilke AI-modeller utviklere bruker i OpenCode, og hvordan fordelingen endrer seg over tid. Det publiserer en toppliste over modeller, tokenbruk, kostnader per sesjon og token, cache-andeler, markedsandeler og en fordeling etter land. Tallene samles hver time, med dager og uker i UTC. Antall brukere og sesjoner er omtrentlige, og kostnadene bruker listepriser fra modellkatalogen til OpenCode. Journalister kan sitere det som OpenCode Data (opencode.ai/data) med oppdateringstidspunktet som vises på siden.",
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
        "Stillbilder og korte videoer av hver app, tatt opp fra det ekte produktet. Du kan bruke dem når du skriver om OpenCode.",
      note: "Alle opptak bruker det mørke temaet. Stillbilder og plakater er JPG-er opptil 1920 × 1080, eller 1080 × 1350 i stående format. Videoer er MP4-klipp uten lyd.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-film" },
            "frame-1": { title: "Desktop-bilde 1" },
            "frame-2": { title: "Desktop-bilde 2" },
            "frame-3": { title: "Desktop-bilde 3" },
            "frame-4": { title: "Desktop-bilde 4" },
            "feature-1": { title: "Sesjoner i faner" },
            "feature-2": { title: "Se gjennom og kommenter" },
            "feature-3": { title: "Se det i nettleseren" },
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
            "feature-2": { title: "Godkjenning" },
            "feature-3": { title: "Sesjoner" },
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
            "feature-2": { title: "Godkjenn det som kjører" },
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
      all: { text: "Last ned alt" },
    },
    coverage: { title: "Omtale" },
    brand: {
      title: "Merke",
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
          body: "Den nyeste OpenCode-appen. Ring en sesjon for å snakke med agenten, og se gjennom og godkjenn endringene fra telefonen, hvor som helst.",
        },
        terminal: {
          name: "Terminal",
          body: "Et terminalgrensesnitt som fungerer i alle skall, editorer og eksterne servere. Se hver endring som en diff, og velg hvilke kommandoer som kjører av seg selv.",
        },
        sdk: {
          body: "En typet TypeScript-klient for skript, CI-jobber og dine egne verktøy. Opprett sesjoner, send prompter og strøm alle hendelser idet de skjer.",
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
          body: "For hjelp med OpenCode kan du opprette en issue eller spørre fellesskapet. Send oss en e-post om konto og fakturering.",
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
    ide: {
      lead: "Kjør opencode i den integrerte terminalen i editoren din, så installerer utvidelsen seg selv. Du kan også installere den selv.",
      links: {
        "vs-code-marketplace": { label: "VS Code Marketplace" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      more: { label: "Sett opp Zed, JetBrains-IDE-er og andre ACP-editorer" },
    },
    mini: {
      commands: { curl: { name: "Skript" } },
      lead: "Mini følger med OpenCode CLI. Installer den på en av disse måtene, og kjør så opencode mini.",
    },
  },
  pair: {
    title: "Koble til telefonen",
    cardTitle: "Koble telefonen med én kommando",
    intro:
      "OpenCode Mobile er en fjernkontroll for OpenCode på datamaskinen din. Sesjonene fortsetter å kjøre der, og appen viser dem og lar deg styre dem.",
    steps: {
      "get-the-app": {
        title: "Hent appen",
        body: "Installer OpenCode-betaen på iPhonen din fra TestFlight. Android-appen kommer snart.",
      },
      "run-this-on-your-computer": {
        title: "Kjør dette på datamaskinen",
        body: "Den skriver ut en engangslenke og en QR-kode. De virker én gang og utløper etter 5 minutter.",
      },
      "scan-the-code": {
        title: "Skann koden",
        body: "Skann QR-koden med appen, eller lim inn lenken. De siste sesjonene fra datamaskinen åpnes på telefonen.",
      },
    },
    note: "--remote kobler til via en OpenTunnel-adresse, så det fungerer fra hvilket som helst nettverk. På samme Wi-Fi kjører du opencode service set hostname 0.0.0.0 én gang og deretter opencode pair.",
    facts: [
      "Tilkoblingen fungerer fra alle nettverk, fordi --remote kobler til via en OpenTunnel-adresse.",
      "Lenken og koden virker én gang og utløper etter 5 minutter.",
      "La datamaskinen være på, for agenten kjører der og ikke på telefonen.",
      "På samme Wi-Fi kjører du opencode service set hostname 0.0.0.0 én gang og deretter opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Lag, installer og del skrivebordsplugins.",
      link: "Se nytt i 2.2",
    },
    "desktop-terminals-now-survive-restarts": { text: "Terminaler i Desktop overlever nå omstart.", link: "Se v2.2.4" },
    "agents-can-now-generate-images": { text: "Agenter kan nå lage bilder.", link: "Se v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "Styr sesjonene dine fra telefonen.", link: "Møt OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "En fornyet skrivebordsapp.", link: "Se nytt i 2.2" },
  },
} satisfies ContentOverlay
