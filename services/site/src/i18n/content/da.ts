import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessioner, faner, diffs, indbygget browser og udvidelser på macOS, Windows og Linux.",
      action: "Download",
    },
    mobile: {
      name: "Mobile",
      body: "Start, styr og godkend sessioner fra din telefon, uanset hvor du er.",
      action: "Download",
    },
    terminal: {
      name: "Terminal",
      body: "En hurtig terminalbrugerflade, der virker i enhver shell, i enhver editor og på enhver fjernserver.",
      action: "Installer",
    },
    sdk: { body: "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer.", action: "Læs docs" },
    mini: {
      body: "En enkel terminalbrugerflade. Svarene lander i din scrollback, med én prompt nederst.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktopapp til macOS, Windows og Linux",
      description:
        "Kør så mange OpenCode-agenter parallelt, som du vil, følg alle ændringer i browseren ved siden af, og fortsæt på en hvilken som helst enhed. Til macOS, Windows og Linux.",
      intro:
        "Kør flere agenter samtidig, hver session i sin egen fane. Gennemgå alle ændringer som diffs, kommentér på de linjer, du vil, og se resultatet i den indbyggede browser. Til macOS, Windows og Linux.",
      showcase: {
        "parallel-agents": {
          title: "Parallelle agenter",
          body: "Start så mange agenter, du vil, og lad dem arbejde parallelt. Skift mellem dem, efterhånden som de bliver færdige.",
        },
        "see-it-in-the-browser": {
          title: "Se det i browseren",
          body: "Din app åbner i browseren ved siden af agenten, så I begge kan følge med, når ændringerne lander.",
        },
        "on-every-device": {
          title: "På alle enheder",
          body: "Start agenter på alle dine enheder, og fortsæt i desktopappen, i terminalen eller på telefonen.",
        },
        "extend-it": {
          title: "Udvid den",
          body: "Forbind dine værktøjer og tjenester, så agenten kan arbejde med hvad som helst. Eller lad OpenCode bygge sine egne plugins med hver sin brugerflade i sidebaren.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile – dine kodningssessioner på telefonen",
      description:
        "Start og styr OpenCode-sessioner fra din telefon. Tal med agenten, mens den kører på din computer.",
      intro:
        "Start og styr sessioner fra telefonen, uanset hvor du er. Ring til en session, og tal med agenten, eller åbn en session, og fortsæt, hvor du slap. OpenCode kører stadig på din egen computer.",
      features: {
        "notify-when-done": {
          title: "Besked når færdig",
          body: "Få et kort resumé, når en session, du har startet, er færdig.",
        },
        "pair-from-anywhere": {
          title: "Par hvor som helst",
          body: "Forbind fra ethvert netværk med opencode pair --remote.",
        },
        "every-computer": { title: "Alle computere", body: "Skift mellem dine parrede computere med ét tryk." },
        "siri-and-shortcuts": {
          title: "Siri og Genveje",
          body: "Start et opkald eller en session fra Siri eller Kontrolcenter.",
        },
        "follow-along": { title: "Følg med", body: "Se tidslinjen opdatere, mens agenten arbejder." },
        "your-computer": { title: "Din computer", body: "Forbinder til OpenCode, der kører på din egen maskine." },
        "share-sheet": { title: "Delingsmenu", body: "Del hvad som helst med en session uden at åbne appen." },
        "mute-sessions": { title: "Slå lyd fra", body: "Behold en session på listen uden at få dens notifikationer." },
      },
      showcase: {
        voice: { title: "Stemme", body: "Ring til en session, og sig, hvad du har brug for. Agenten svarer med stemmen." },
        sessions: { title: "Sessioner", body: "Åbn en session for at se, hvor langt den er nået, og fortsæt, hvor du slap." },
        results: { title: "Resultater", body: "Når arbejdet er færdigt, får du at vide i opkaldet, hvad der er ændret." },
      },
    },
    terminal: {
      title: "OpenCode | Terminal-UI til open source-kodningsagenten",
      description:
        "En hurtig terminalbrugerflade til OpenCode, der virker i enhver shell, editor og på enhver fjernserver. Beskriv, hvad du vil have, se alle ændringer som diffs, og godkend kommandoer.",
      intro:
        "En hurtig terminalbrugerflade, der virker i enhver shell, editor og på enhver fjernserver. Beskriv med egne ord, hvad du vil have, se hver ændring som et diff med det samme, og vælg, hvilke kommandoer der kører automatisk.",
      features: {
        "any-terminal": {
          title: "Enhver terminal",
          body: "Virker i enhver shell, i din editors terminal eller på en fjernserver.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs på tidslinjen",
          body: "Se hver ændring på tidslinjen som et diff, så snart agenten laver den.",
        },
        "pick-up-later": {
          title: "Fortsæt senere",
          body: "Fortsæt den seneste session med -c eller en valgfri session med -s.",
        },
        "one-off-runs": { title: "Enkeltkørsler", body: "opencode run sender én besked og udskriver svaret." },
        "agents-and-commands": {
          title: "Agenter og kommandoer",
          body: "Skift agent med shift+tab, og åbn kommandolisten med ctrl+p.",
        },
        "auto-approve": {
          title: "Autogodkend",
          body: "Kør med --auto for at tillade alle handlinger, du ikke har afvist.",
        },
        "any-server": { title: "Enhver server", body: "Opret forbindelse til en OpenCode-server via dens URL med --server." },
        "usage-stats": { title: "Forbrugsstatistik", body: "opencode stats viser forbrugsstatistik, du kan dele." },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Skriv med egne ord",
          body: "Skriv, hvad du vil have, så viser agenten sin plan undervejs.",
        },
        "approve-what-runs": {
          title: "Godkend det, der kører",
          body: "Ændringer vises som diffs, og kommandoer venter på din tilladelse.",
        },
        "make-it-yours": {
          title: "Tilpas terminalen",
          body: "Skift tema med et tastetryk. Vælg mellem standardtemaet, tokyonight og flere andre.",
        },
        mini: { title: "Mini", body: "Kør opencode mini, så lander svarene direkte i din scrollback." },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript-SDK til scripts, CI-jobs og værktøjer",
      description:
        "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer. Den typesikre TypeScript-klient opretter sessioner, sender prompts og streamer alle hændelser i realtid.",
      intro:
        "Styr OpenCode fra dine egne scripts, CI-jobs og værktøjer. SDK'et kører OpenCode i din proces med din konfiguration og dine modeller. Den typesikre klient opretter sessioner, sender prompts og streamer alle hændelser.",
      features: {
        "typescript-client": {
          title: "TypeScript-klient",
          body: "Anmodninger og hændelser med typer og samme værdier som @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessioner fra kode",
          body: "Opret sessioner, og send prompts fra et hvilket som helst script.",
        },
        "any-model": { title: "Enhver model", body: "Bruger de modeller, du har sat op i OpenCode." },
        "npm-or-bun": {
          title: "npm eller bun",
          body: "Installer det med npm i @opencode/sdk eller bun add @opencode/sdk.",
        },
        "in-process-host": { title: "In-process-host", body: "Kører OpenCode i hukommelsen, uden at gå via netværket." },
        "your-plugins": {
          title: "Dine plugins",
          body: "Send dine egne plugins med, når du opretter in-process-hosten.",
        },
        "promise-or-effect": {
          title: "Promise eller Effect",
          body: "En Promise-API og en Effect-API med de samme værdier.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Kør OpenCode i et Cloudflare Durable Object på Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Ret CI-fejl fra kode",
          body: "Et kort script beder OpenCode rette de tests, der fejler, og kører dem igen.",
        },
        "follow-every-step": {
          title: "Følg hvert trin",
          body: "Stream hændelser, og se hvert værktøjskald, efterhånden som det sker.",
        },
        "build-your-own-tools": {
          title: "Byg dine egne værktøjer",
          body: "Kobl OpenCode til bots, dashboards og arbejdsgange med få linjer kode.",
        },
        "in-your-process": {
          title: "I din proces",
          body: "Kører OpenCode i din proces med din konfiguration og dine modeller.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, en minimal terminalbrugerflade til agenten",
      description:
        "Mini kører OpenCode i en enkel terminalbrugerflade. Svarene lander i terminalens egen scrollback, så kun en prompt og en statuslinje bliver stående nederst.",
      intro:
        "En enkel terminalbrugerflade til OpenCode. Kør opencode mini, så lander svarene direkte i terminalens egen scrollback. Rul, søg og kopiér som med alt andet output. Kun prompten og en statuslinje bliver stående nederst.",
      features: {
        "your-scrollback": { title: "Din scrollback", body: "Svarene vises i terminalens almindelige historik." },
        "one-prompt": { title: "Én prompt", body: "Agent, model, kontekst og pris på én statuslinje." },
        permissions: { title: "Tilladelser", body: "Tillad ændringer og kommandoer fra promptområdet." },
        "how-much-shows": {
          title: "Hvor meget du ser",
          body: "Vælg stille, standard eller fuld visning af modellens ræsonnering og værktøjernes output.",
        },
        "pick-up-later": {
          title: "Fortsæt senere",
          body: "Fortsæt den seneste session med -c eller en valgfri session med -s.",
        },
        "same-opencode": { title: "Samme OpenCode", body: "Samme server, agenter og modeller som de andre apps." },
        agents: { title: "Agenter", body: "Skift agent direkte fra prompten." },
        compact: { title: "Komprimer", body: "Komprimer en lang session med /compact." },
      },
    },
  },
  extensionCard: {
    name: "Udvidelser",
    body: "Brug OpenCode i VS Code eller i Zed og andre editorer via ACP.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "Giv agenter adgang til den browser, du bruger til daglig.",
      title: "OpenCode | Browse giver kodningsagenter adgang til din egen browser",
      description:
        "Med Browse kan OpenCode og andre MCP-klienter bruge din egen browser. Agenter kan læse, klikke, skrive, tage skærmbilleder og optage faner. Du tager selv over, når du skal logge ind eller bekræfte med 2FA.",
      intro:
        "En MCP-server og en Chromium-udvidelse, så dine agenter kan bruge din egen browser med dine faner, login og udvidelser. Agenterne åbner grupper af faner i baggrunden, så de ikke forstyrrer dig. De kan læse sider, klikke, skrive, tage skærmbilleder og optage faner. Skal du logge ind, bekræfte med 2FA eller betale, får du fanen tilbage. Agenterne fortsætter, når du klikker på Continue.",
      features: {
        "your-real-browser": {
          title: "Din egen browser",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera og Chromium.",
        },
        "out-of-your-way": { title: "Faner, der ikke forstyrrer", body: "Agenternes faner åbner i baggrunden i sammenklappede grupper." },
        handoffs: { title: "Tag selv over", body: "Log ind eller gennemfør 2FA selv, og klik så på Continue." },
        "lend-a-tab": {
          title: "Lån en fane ud",
          body: "Klik på knappen i værktøjslinjen for at give en agent en åben fane.",
        },
        "record-and-capture": {
          title: "Optagelser og skærmbilleder",
          body: "Skærmbilleder, optagelser af faner og netværkstrafik.",
        },
        "any-mcp-client": {
          title: "Enhver MCP-klient",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed og mange flere.",
        },
        "all-your-logins": {
          title: "Allerede logget ind",
          body: "Agenterne kan bruge de sider, du allerede er logget ind på. Ingen nøgler eller opsætning.",
        },
        "allowed-sites": { title: "Tilladte websites", body: "Begræns agentens fane til de websites, du angiver." },
      },
      install:
        "Installer [Chrome-udvidelsen] først. Den guider dig gennem resten af trinene. Vil du installere CLI'en direkte, selvom det normalt ikke er nødvendigt, så brug en af disse metoder.",
    },
  },
  apps: {
    browse: {
      category: "Browserstyring for agenter",
      body: "Lad din agent bruge din egen browser med dine login og faner.",
    },
    opentunnel: { category: "Lokale tunneler", body: "Offentlige HTTPS-URL'er til lokale apps." },
    opentui: { category: "Bibliotek", body: "Et bibliotek til terminalbrugerflader." },
    hex: { category: "Diktering", body: "Diktering direkte på enheden til enhver app." },
  },
  getStarted: {
    title: "Kom i gang",
    lead: "Download OpenCode, og brug de gratis modeller. Det er den nemmeste måde at starte på, og du behøver ingen konto. Brug dit eget abonnement eller OpenCode Go, hvis du vil have mere.",
    phrases: {
      "download-opencode": { text: "downloade OpenCode" },
      "free-models": { text: "gratis modeller" },
      "your-own-subscription": { text: "dit eget abonnement" },
      "a-subscription-you-already-have": { text: "et abonnement, du allerede har" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "Download", line: "Desktop, terminal eller mobil." },
      "use-free-models": {
        title: "Brug gratis modeller",
        line: "OpenCode har gratis modeller, du kan bruge uden en konto.",
      },
      "add-more-models": {
        title: "Tilføj flere modeller",
        line: "Brug dit eget abonnement, eller få udvalgte modeller med OpenCode Go fra $10/måned.",
      },
    },
    sentence:
      "Download OpenCode, og start med de gratis modeller. Brug dit eget abonnement eller OpenCode Go, når du vil have mere.",
  },
  byos: {
    title: "Brug dit eget abonnement",
    headline: "Brug de abonnementer, du allerede har.",
    line: "Log ind med dit abonnement på ChatGPT Plus, ChatGPT Pro eller GitHub Copilot. Du kan også bruge et OpenCode-abonnement.",
    yours: { label: "Dit abonnement", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["OpenCode-abonnement"],
    ours: { label: "OpenCode-abonnementer" },
  },
  brand: {
    hero: { copy: { text: "Regler til din agent", copied: "Regler kopieret" } },
    naming: {
      title: "Navn",
      body: "Skriv OpenCode i ét ord med stort O og stort C. Skriv ikke Opencode, Open Code, OpenCode AI eller Open-Code.",
      code: "Brug kun `opencode` med små bogstaver i kode og pakkenavne, som `opencode-figma` eller `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Logoet alene, til appikoner, avatarer og andre små flader. De kvadratiske versioner har ekstra luft til steder, der beskærer til et kvadrat.",
        assets: {
          light: { name: "Lyst" },
          dark: { name: "Mørkt" },
          "square-light": { name: "Kvadratisk, lyst" },
          "square-dark": { name: "Kvadratisk, mørkt" },
        },
      },
      wordmark: {
        title: "Ordmærke",
        body: "Det fulde navn skrevet med OpenCodes egne bogstaver. Brug ordmærket, hvor der er plads til hele navnet.",
        assets: { light: { name: "Lyst" }, dark: { name: "Mørkt" } },
      },
      "simple-wordmark": {
        title: "Enkelt ordmærke",
        body: "En ensfarvet version af ordmærket til tryk, broderi og steder, der kun tillader én farve.",
        assets: { light: { name: "Lyst" }, dark: { name: "Mørkt" } },
      },
    },
    icons: {
      title: "Avatarer",
      body: "Kvadratiske avatarer på 1024px til Slack, Discord, GitHub og andre profiler. Baggrunden fylder hele kvadratet, og logoet sidder et godt stykke inde i cirklen, så det klarer en rund beskæring.",
      items: { dark: { name: "Mørkt" }, light: { name: "Lyst" } },
    },
    colors: {
      title: "Farver",
      body: "Logoet og ordmærket bruger én farve i tre grader af opacitet og en lysere farve til mørke baggrunde. Værdierne nedenfor er farverne i standardfilerne. Brug dem kun til logoet og ordmærket, ikke til anden tekst eller til baggrunde. Klik på en værdi for at kopiere den.",
      palettes: {
        light: {
          name: "Lyst",
          swatches: {
            ink: { name: "Farve", use: "Logoets kontur og bogstaverne i »code«." },
            "ink-70": { name: "Farve 70%", use: "Bogstaverne i »open«.", ink: "Farven med 70% opacitet." },
            "ink-20": { name: "Farve 20%", use: "Logoets indre skygge.", ink: "Farven med 20% opacitet." },
          },
        },
        dark: {
          name: "Mørkt",
          swatches: {
            ink: { name: "Farve", use: "Logoets kontur og bogstaverne i »code«." },
            "ink-72": { name: "Farve 72%", use: "Bogstaverne i »open«.", ink: "Farven med 72% opacitet." },
            "ink-28": { name: "Farve 28%", use: "Logoets indre skygge.", ink: "Farven med 28% opacitet." },
          },
        },
      },
    },
    variants: {
      title: "Varianter",
      body: "Vælg den variant, der står tydeligst på baggrunden: mørk på lys baggrund og lys på mørk baggrund. Logoet og ordmærket ligger i hver sin fil. Brug det ene eller det andet.",
      groups: {
        default: {
          name: "Standard",
          body: "Brug dette logo i de fleste tilfælde. Den indre skygge er gennemsigtig. På hvid eller sort baggrund ser den ud præcis som de tofarvede grå varianter. På fotos, gradienter og farver skinner baggrunden igennem.",
          rows: {
            logo: { title: "Logo", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } },
            wordmark: { title: "Ordmærke", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } },
          },
        },
        simple: {
          name: "Enkel",
          body: "Én farve, åbne indre bogstavrum og ingen indre skygge. Brug varianten på ensfarvede baggrunde, til tryk i én farve og andre steder, hvor gråtonerne ikke kan bruges. Vælg den enkle mørke variant på lyse farver og den enkle lyse på mørke farver.",
          rows: { wordmark: { title: "Ordmærke", tiles: { dark: { name: "Mørkt" }, light: { name: "Lyst" } } } },
        },
      },
    },
    usage: {
      title: "Brug",
      body: "Brug de lyse versioner på lyse baggrunde og de mørke versioner på mørke baggrunde. Logoet og ordmærket er separate. Brug det ene eller det andet, ikke begge sammen.",
      stroke: {
        title: "Én streg",
        body: "Afstandsreglerne på denne side måles i streger. Én streg er tykkelsen af logoets kontur, altså en fjerdedel af dets bredde, så logoet er 4 streger bredt og 5 streger højt.",
      },
      clearSpace: {
        title: "Frirum",
        body: "Hold mindst to stregers afstand på alle sider af logoet og ordmærket. For logoet er en streg tykkelsen af dets kontur, en fjerdedel af bredden. For ordmærket er det tykkelsen af bogstaverne, en syvendedel af højden.",
      },
      pixels: {
        title: "Hele pixels",
        body: "Logoets proportioner er låst til 4:5, og én streg er en fjerdedel af dets bredde. Skaler det i trin på 4 × 5px, så hver kant og hver streg lander på en hel pixel.",
        do: "at hver kant og stregen på 4px lander på hele pixels.",
        dont: "at ændre logoets proportioner fra 4:5. Ellers falder kanterne mellem pixels og bliver slørede.",
        sizes: { logo: { title: "Logo" }, wordmark: { title: "Ordmærke" } },
      },
      minimumTitle: "Minimumsstørrelser",
      minimum: {
        logo: { title: "Logo", body: "Mindst 16 × 20px med en streg på 4px. Ved mindre størrelser bliver logoet sløret." },
        wordmark: {
          title: "Ordmærke",
          body: "Mindst 117 × 21px med en streg på 3px. Ved mindre størrelser bliver ordmærket sløret.",
        },
      },
    },
    donts: {
      title: "Undgå",
      body: "Almindelige fejl, du skal undgå, når du bruger logoet og ordmærket.",
      examples: {
        "two-tone": { caption: "at farve logoet i nye farver." },
        bright: { caption: "at bruge én skarp farve." },
        gradient: { caption: "at fylde logoet med en gradient." },
        inverted: { caption: "at bytte om på tonerne." },
        stretch: { caption: "at strække eller trykke logoet sammen." },
        shadow: { caption: "at tilføje slagskygger." },
        glow: { caption: "at tilføje glød eller konturer." },
        lockup: { caption: "at sætte andre ord ved siden af logoet." },
        "low-contrast": { caption: "at bruge grå på grå med lav kontrast." },
        color: { caption: "at bruge det tofarvede grå logo på en farvet baggrund, hvor gråtonerne mister deres klarhed." },
      },
    },
    integrations: {
      title: "Integrationer",
      body: "Hvis dit plugin, din udbyder eller dit værktøj virker med OpenCode, eller dit projekt er bygget med det, må du gerne skrive det. Brug et badge eller en kombination med partnerlogo, og vælg et navn, der gør det klart, at projektet er dit.",
      badges: {
        body: "Sæt et badge i din README, i dokumentationen eller på dit website, og lad det linke til opencode.ai. Vælg den lyse eller mørke fil efter din baggrund (HTML-versionen skifter automatisk). Ændr ikke farverne eller teksten.",
        sizes: "Alle varianter fås i 20, 32 og 44px (Shields kun i 20px) som SVG og som PNG i 2× opløsning.",
        mono: "Hver fil fås også med tekst i OpenMono. Sæt -mono før filendelsen, som i opencode-works-with-a-light-20-mono.svg, eller -mono-caps for store bogstaver i OpenMono.",
        groups: {
          "works-with": {
            title: "Virker med",
            alt: "Virker med OpenCode",
            body: "Til plugins, udbydere og værktøjer, der kører med OpenCode.",
          },
          "built-with": { title: "Bygget med", alt: "Bygget med OpenCode", body: "Til projekter lavet med OpenCode." },
        },
        styles: { a: { name: "Ramme" }, c: { name: "Celler" }, f: { name: "Udfyldt" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "Kombination med partnerlogo",
        body: "Sæt OpenCode-logoet og partnerens logo ved siden af hinanden med et × imellem. Lad der være 3 stregers afstand på hver side af ×, skalér partnerens logo, så det ser lige så højt ud som OpenCode-logoet, og hold frirum omkring hele kombinationen.",
      },
      naming: {
        title: "Navngiv dit projekt",
        body: "Start med dit eget navn, så det er tydeligt, at projektet er dit.",
        rule: "Skriv `Linear for OpenCode`, eller kald pakken `opencode-linear`. Skriv ikke `OpenCode Linear` eller `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Varemærker",
      body: "OpenCode og OpenCode-logoet er Anomalys varemærker. Brug dem ikke til at antyde, at Anomaly støtter eller sponsorerer dig, i dit produkt- eller firmanavn eller på merchandise uden tilladelse.",
      contact: { before: "Spørgsmål kan sendes til " },
    },
  },
  press: {
    title: "OpenCode | Pressekit med fakta og brandmateriale",
    description:
      "OpenCodes pressekit med fakta om OpenCode og virksomheden bag, Anomaly. Her finder du også logoer og ordmærker til download og kontaktoplysninger til pressen.",
    hero: { title: "Presse", body: "Fakta, brandmateriale og kontaktoplysninger til dig, der skriver om OpenCode og Anomaly." },
    company: {
      title: "Om Anomaly",
      lead: "Anomaly er virksomheden bag OpenCode. Anomaly bygger open source-værktøjer til udviklere.",
      more: "Andre projekter er bl.a. SST og OpenTUI, alle open source på [GitHub](github).",
      learnMore: "Læs mere på [anoma.ly](site).",
      projects: {
        opencode: {
          body: "Open source-kodningsagenten med apps til desktop, terminal og mobil og et SDK. MIT-licenseret, over 220.000 GitHub-stjerner.",
        },
        sst: {
          body: "Et framework til at bygge full-stack-apps på din egen infrastruktur. MIT-licenseret og open source siden 2020. Over 26.000 GitHub-stjerner.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Et bibliotek til terminalbrugerflader i TypeScript, React eller Solid med en kerne i Zig. OpenCode bruger det i produktion. Over 13.000 GitHub-stjerner.",
        },
        "models-dev": {
          body: "En open source-database med specifikationer, priser og funktioner for AI-modeller og et offentligt API. Den indeholder over 8.900 modeller fra over 200 udbydere.",
        },
        hex: {
          body: "Diktering til Mac, Windows og Linux. Hex transskriberer på din enhed og indsætter teksten i enhver app, så lyden aldrig forlader enheden.",
        },
        opentunnel: {
          body: "En CLI og et SDK, der giver apps på din computer en offentlig HTTPS-URL. TLS termineres på din computer, så relayet aldrig ser klartekst.",
        },
      },
    },
    about: {
      title: "Om OpenCode",
      body: "Korte og lange beskrivelser af OpenCode og produkterne, lige til at kopiere.",
      boilerplate: {
        long: "OpenCode er en open source-kodningsagent. Den findes som desktopapp, terminal-UI, mobilapp og SDK og virker med modeller fra enhver udbyder, bl.a. Claude, GPT og Gemini. OpenCode er MIT-licenseret og lavet af Anomaly. Den har over 220.000 GitHub-stjerner og mere end 1.000 bidragydere, og over 22 millioner udviklere bruger den hver måned.",
        short:
          "OpenCode er en open source-kodningsagent fra Anomaly med apps til desktop, terminal og mobil og et SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console er webappen, hvor udviklere og teams køber og styrer adgangen til AI-modeller for OpenCode og andre kodningsagenter. Her får du inferens til frontier- og open weight-modeller, afregnet pr. anmodning fra forudbetalt kredit, samt OpenCode Go-abonnementer. Teams får arbejdsområder med rollerne Member, Admin og Owner, forbrugsgrænser for hele arbejdsområdet og pr. bruger, single sign-on med Okta, Microsoft Entra ID eller Google Workspace samt SCIM. Console understøtter over 30 udbydere, så teams kan forbinde de udbyderkonti, de allerede har. Det er valgfrit at bruge OpenCodes inferens. Find Console på opencode.ai/console.",
          short:
            "OpenCode Console er Anomalys webapp med adgang til AI-modeller betalt efter forbrug, OpenCode Go-abonnementer og værktøjer til teams som budgetter og single sign-on.",
        },
        "opencode-go": {
          long: "OpenCode Go er et abonnement til udviklere, der vil have kodningsmodeller til en fast månedspris. Go koster $10/måned, Go Plus koster $40/måned med højere grænser, og Go Teams koster $20/medlem/måned. Hvert abonnement har et udvalg af modeller testet til agentisk kodning. Forbrugsgrænserne er månedlige beløb i dollars for hver model med rullende kvoter på 20 % af månedsgrænsen pr. 5 timer og 50 % pr. uge. Du kan tilføje kredit, betale ekstra forbrug fra din saldo og opsige når som helst. Go virker med OpenCode og andre agenter. Find det på opencode.ai/console/go.",
          short:
            "OpenCode Go er et månedligt abonnement fra Anomaly til udviklere. Fra $10/måned får du månedlige forbrugsgrænser for et udvalg af kodningsmodeller.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data er et offentligt dashboard, der viser, hvilke AI-modeller udviklere bruger i OpenCode, og hvordan fordelingen ændrer sig over tid. Det viser en rangliste over de mest brugte modeller, tokenforbrug, omkostninger pr. session og token, cacheandele, markedsandele og tal fordelt på lande. Tallene samles hver time, og dage og uger opgøres i UTC. Antallet af brugere og sessioner er omtrentligt. Omkostningerne beregnes ud fra listepriserne i OpenCodes modelkatalog. Journalister kan citere kilden som OpenCode Data (opencode.ai/data) med det opdateringstidspunkt, der står på siden.",
          short:
            "OpenCode Data er et offentligt dashboard på opencode.ai/data, der rangerer AI-modeller efter faktisk forbrug i OpenCode. Tal for tokens, omkostninger og markedsandele opdateres hver time.",
        },
      },
    },
    facts: {
      title: "Kort fortalt",
      items: {
        license: { label: "Licens" },
        "first-release": { label: "Første version" },
        "made-by": { label: "Lavet af" },
      },
    },
    milestones: {
      title: "Milepæle",
      items: {
        "first-release-v0-0-1": { date: "apr. 2025", text: "Første version, v0.0.1" },
        "1-million-downloads": { date: "okt. 2025", text: "Over 1 million downloads" },
        "opencode-1-0": { date: "okt. 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "dec. 2025", text: "Desktopappen udkommer" },
        "10-million-downloads": { date: "jan. 2026", text: "Over 10 millioner downloads" },
        "opencode-2-0": { date: "sep. 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "nov. 2026", text: "Over 220.000 GitHub-stjerner" },
      },
    },
    news: {
      title: "Seneste versioner",
      intro: "OpenCode udkommer ofte. Her er de nyeste versioner med nye funktioner.",
      changelog: { text: "Hele ændringsloggen" },
      feed: { text: "RSS-feed" },
    },
    media: {
      title: "Medier",
      intro:
        "Stillbilleder og korte videoer fra hver app, optaget direkte i produktet. Du kan bruge dem, når du skriver om OpenCode.",
      note: "Alt materiale er optaget med det mørke tema. Stillbilleder og plakatbilleder er JPG'er på op til 1920 × 1080 eller 1080 × 1350 i højformat. Videoerne er MP4-klip uden lyd.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "Desktop-film" },
            "frame-1": { title: "Desktop-billede 1" },
            "frame-2": { title: "Desktop-billede 2" },
            "frame-3": { title: "Desktop-billede 3" },
            "frame-4": { title: "Desktop-billede 4" },
            "feature-1": { title: "Parallelle agenter" },
            "feature-2": { title: "Se det i browseren" },
            "feature-3": { title: "På alle enheder" },
            "locked-portrait": { title: "Desktop-film, portræt" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "Mobile-film" },
            "frame-1": { title: "Mobile-billede 1" },
            "frame-2": { title: "Mobile-billede 2" },
            "frame-3": { title: "Mobile-billede 3" },
            "feature-1": { title: "Stemme" },
            "feature-2": { title: "Sessioner" },
            "feature-3": { title: "Resultater" },
            "locked-portrait": { title: "Mobile-film, portræt" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "Terminal-film" },
            "frame-1": { title: "Terminal-billede 1" },
            "frame-2": { title: "Terminal-billede 2" },
            "frame-3": { title: "Terminal-billede 3" },
            "frame-4": { title: "Terminal-billede 4" },
            "feature-1": { title: "Skriv med egne ord" },
            "feature-2": { title: "Godkend det, der kører" },
            "feature-3": { title: "Tilpas terminalen" },
            "locked-portrait": { title: "Terminal-film, portræt" },
          },
        },
        sdk: {
          items: {
            "locked-landscape": { title: "SDK-film" },
            "frame-1": { title: "SDK-billede 1" },
            "frame-2": { title: "SDK-billede 2" },
            "frame-3": { title: "SDK-billede 3" },
            "frame-4": { title: "SDK-billede 4" },
            "feature-1": { title: "Ret CI fra kode" },
            "feature-2": { title: "Følg hvert trin" },
            "feature-3": { title: "Byg dine egne værktøjer" },
            "locked-portrait": { title: "SDK-film, portræt" },
          },
        },
      },
    },
    people: { title: "Personer" },
    anomalyLogo: {
      title: "Anomaly-logo",
      body: "Anomaly-mærket og ordmærket i sort og hvid. PNG'er er 2048 px brede.",
      assets: {
        "mark-black": { name: "Mærke, sort" },
        "mark-white": { name: "Mærke, hvid" },
        "wordmark-black": { name: "Ordmærke, sort" },
        "wordmark-white": { name: "Ordmærke, hvid" },
      },
      avatars: {
        body: "Kvadratiske avatarer til X, GitHub, Slack, LinkedIn og andre profiler. Mærket sidder et godt stykke inde i cirklen, så det klarer en rund beskæring. PNG'er er 1024 og 400 px brede.",
        items: {
          "avatar-dark": { name: "Avatar, mørk" },
          "avatar-light": { name: "Avatar, lys" },
        },
      },
      all: { text: "Download alt" },
    },
    coverage: { title: "Omtale" },
    brand: {
      title: "Brand",
      before:
        "Download OpenCode-logoerne og -ordmærkerne i én ZIP-fil. Enkelte filer, varianter og regler for brug finder du på ",
      link: { text: "brandsiden" },
      usage:
        "Du kan bruge filerne, når du skriver om OpenCode. Ændr dem ikke, og antyd ikke, at OpenCode støtter dit arbejde.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Kør flere agenter på én gang, hver i sin egen fane, på macOS, Windows og Linux. Gennemgå hver ændring som et diff, og se en forhåndsvisning.",
        },
        mobile: {
          name: "Mobile",
          body: "Den nyeste OpenCode-app. Ring til en session for at tale med agenten. Gennemgå og godkend derefter ændringerne fra telefonen, uanset hvor du er.",
        },
        terminal: {
          name: "Terminal",
          body: "En terminalbrugerflade til enhver shell, editor og fjernserver. Se alle ændringer som diffs, og vælg, hvilke kommandoer der kører automatisk.",
        },
        sdk: {
          body: "En typesikker TypeScript-klient til scripts, CI-jobs og dine egne værktøjer. Opret sessioner, send prompts, og stream alle hændelser i realtid.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: { title: "Presse", body: "Til journalister og analytikere. Vi svarer kun på henvendelser fra medier." },
        support: {
          title: "Support",
          body: "Få hjælp til OpenCode ved at oprette et issue eller spørge i fællesskabet. Skriv til os med spørgsmål om konto og fakturering.",
          links: { "github-issues": { text: "GitHub-issues" }, "help-anoma-ly": { text: "help@anoma.ly" } },
        },
        security: {
          title: "Sikkerhed",
          body: "Rapporter en sårbarhed via GitHub. Skriv til os, hvis ingen svarer inden for 6 hverdage.",
          links: {
            "report-a-vulnerability": { text: "Rapporter en sårbarhed" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "Script" } } },
    extensions: {
      title: "Udvidelser",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "Script" } } },
    sdk: { more: { label: "Læs SDK-dokumentationen" } },
    mini: {
      commands: { curl: { name: "Script" } },
      lead: "Mini følger med OpenCode CLI. Brug en af disse installationsmetoder, og kør derefter opencode mini.",
    },
  },
  pair: {
    title: "Forbind din telefon",
    cardTitle: "Par telefonen med én kommando",
    intro:
      "OpenCode Mobile er en fjernbetjening til OpenCode på din computer. Dine sessioner fortsætter på computeren, mens du følger og styrer dem fra appen.",
    steps: {
      "get-the-app": {
        title: "Hent appen",
        body: "Installer OpenCode-betaen på din iPhone via TestFlight, eller hent appen til din Android-telefon.",
      },
      "run-this-on-your-computer": {
        title: "Kør dette på din computer",
        body: "Den udskriver et engangslink og en QR-kode. De virker én gang og udløber efter 5 minutter.",
      },
      "scan-the-code": {
        title: "Scan koden",
        body: "Scan QR-koden med appen, eller indsæt linket. Så vises computerens seneste sessioner på telefonen.",
      },
    },
    note: "Med --remote går forbindelsen via en OpenTunnel-adresse og virker derfor fra ethvert netværk. Er du på samme Wi-Fi, så kør opencode service set hostname 0.0.0.0 én gang og derefter opencode pair.",
    facts: [
      "Parringen virker fra ethvert netværk, fordi --remote forbinder via en OpenTunnel-adresse.",
      "Linket og koden virker én gang og udløber efter 5 minutter.",
      "Lad computeren være tændt, for agenten kører der og ikke på telefonen.",
      "Er du på samme Wi-Fi, så kør opencode service set hostname 0.0.0.0 én gang og derefter opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Opret, installer og del plugins til Desktop.",
      link: "Se nyhederne i 2.2",
    },
    "desktop-terminals-now-survive-restarts": { text: "Terminalerne i Desktop bevares nu efter genstart.", link: "Se v2.2.4" },
    "agents-can-now-generate-images": { text: "Agenter kan nu generere billeder.", link: "Se v2.2.1" },
    "steer-your-sessions-from-your-phone": {
      text: "Styr dine sessioner fra din telefon.",
      link: "Mød OpenCode Mobile",
    },
    "a-refreshed-desktop-app": { text: "En fornyet desktopapp.", link: "Se nyhederne i 2.2" },
  },
} satisfies ContentOverlay
