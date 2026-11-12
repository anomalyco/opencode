import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Twórz, instaluj i udostępniaj pluginy desktopowe.",
      link: "Zobacz nowości w 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Terminale w Desktop przetrwają teraz restart.",
      link: "Zobacz v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Agenci mogą teraz generować obrazy.",
      link: "Zobacz v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Steruj sesjami z telefonu.",
      link: "Poznaj OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Odświeżona aplikacja desktopowa.",
      link: "Zobacz nowości w 2.2",
    },
  },
  products: {
    desktop: {
      name: "Desktop",
      body: "Sesje, karty, diffy, wbudowana przeglądarka i rozszerzenia na macOS, Windows i Linux.",
      action: "Pobierz",
    },
    mobile: {
      name: "Mobile",
      body: "Uruchamiaj, prowadź i zatwierdzaj sesje z telefonu, gdziekolwiek jesteś.",
      action: "Pobierz",
    },
    terminal: {
      name: "Terminal",
      body: "Szybki interfejs terminalowy, który działa w każdej powłoce, edytorze i na zdalnym serwerze.",
      action: "Instaluj",
    },
    sdk: {
      name: "SDK",
      body: "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi.",
      action: "Czytaj docs",
    },
    mini: {
      name: "Mini",
      body: "Minimalny interfejs terminalowy. Odpowiedzi trafiają do historii terminala, a pod nimi jest jeden prompt.",
      action: "Instaluj",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Aplikacja desktopowa na macOS, Windows i Linux",
      description:
        "Uruchamiaj równolegle tylu agentów OpenCode, ilu chcesz, oglądaj każdą zmianę w przeglądarce obok i kontynuuj na dowolnym urządzeniu. Na macOS, Windows i Linux.",
      intro:
        "Uruchamiaj kilku agentów naraz, każdą sesję w osobnej karcie. Przeglądaj każdą zmianę jako diff, komentuj dowolną linię i sprawdzaj wynik we wbudowanej przeglądarce. Na macOS, Windows i Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agenci równolegle",
          body: "Uruchom tylu agentów, ilu chcesz, i pozwól im pracować równolegle. Przełączaj się między nimi, gdy kończą.",
        },
        "see-it-in-the-browser": {
          title: "Zobacz w przeglądarce",
          body: "Twoja aplikacja otwiera się w przeglądarce obok agenta, więc oboje widzicie każdą zmianę na bieżąco.",
        },
        "on-every-device": {
          title: "Na każdym urządzeniu",
          body: "Uruchamiaj agentów na wszystkich swoich urządzeniach i kontynuuj w aplikacji desktopowej, terminalu lub na telefonie.",
        },
        "extend-it": {
          title: "Rozszerzaj",
          body: "Podłącz swoje narzędzia i usługi, aby agent mógł pracować ze wszystkim. Albo pozwól OpenCode zbudować wtyczki dla samego siebie, z własnym interfejsem w panelu bocznym.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, Twoje sesje programowania na telefonie",
      description:
        "Uruchamiaj i prowadź sesje OpenCode z telefonu. Rozmawiaj z agentem, gdy działa na Twoim komputerze.",
      intro:
        "Uruchamiaj i prowadź sesje z telefonu, gdziekolwiek jesteś. Zadzwoń do sesji i rozmawiaj z agentem albo otwórz sesję i kontynuuj od miejsca, w którym skończyłeś, wszystko z OpenCode na Twoim komputerze.",
      features: {
        "notify-when-done": {
          title: "Powiadomienia",
          body: "Dostań krótkie podsumowanie, gdy uruchomiona przez Ciebie sesja się skończy.",
        },
        "pair-from-anywhere": {
          title: "Paruj skądkolwiek",
          body: "Łącz się z dowolnej sieci przez opencode pair --remote.",
        },
        "every-computer": {
          title: "Każdy komputer",
          body: "Przełączaj się między sparowanymi komputerami jednym dotknięciem.",
        },
        "siri-and-shortcuts": {
          title: "Siri i Skróty",
          body: "Zacznij rozmowę lub sesję z Siri albo z centrum sterowania.",
        },
        "follow-along": {
          title: "Na bieżąco",
          body: "Patrz, jak oś czasu się aktualizuje, gdy agent pracuje.",
        },
        "your-computer": {
          title: "Twój komputer",
          body: "Łączy się z OpenCode działającym na Twojej maszynie.",
        },
        "share-sheet": {
          title: "Udostępnianie",
          body: "Udostępniaj cokolwiek do sesji bez otwierania aplikacji.",
        },
        "mute-sessions": {
          title: "Wycisz sesje",
          body: "Zostaw sesję na liście bez jej powiadomień.",
        },
      },
      showcase: {
        voice: {
          title: "Głos",
          body: "Zadzwoń do sesji i powiedz, czego chcesz. Agent odpowie na głos.",
        },
        sessions: {
          title: "Sesje",
          body: "Otwórz dowolną sesję, sprawdź jej stan i kontynuuj, gdzie skończyłeś.",
        },
        steer: {
          title: "Prowadź",
          body: "Wyślij kolejną wiadomość, aby zmienić kierunek w trakcie sesji.",
        },
        results: {
          title: "Wyniki",
          body: "Gdy zlecona praca jest gotowa, w rozmowie usłyszysz, co się zmieniło.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interfejs terminalowy agenta open source",
      description:
        "Szybki interfejs terminalowy OpenCode, który działa w każdej powłoce, edytorze i na zdalnym serwerze. Opisz, czego chcesz, oglądaj każdą edycję jako diff i zatwierdzaj polecenia.",
      intro:
        "Szybki interfejs terminalowy, który działa w każdej powłoce, edytorze i na zdalnym serwerze. Opisz zwykłymi słowami, czego chcesz, patrz, jak każda edycja pojawia się jako diff, i wybierz, które polecenia uruchamiają się same.",
      features: {
        "any-terminal": {
          title: "Każdy terminal",
          body: "Działa w każdej powłoce, w terminalu edytora i na zdalnym serwerze.",
        },
        "diffs-in-the-timeline": {
          title: "Diffy na osi",
          body: "Oglądaj każdą edycję jako diff na osi czasu, gdy agent ją wprowadza.",
        },
        "pick-up-later": {
          title: "Wróć później",
          body: "Kontynuuj ostatnią sesję z -c albo dowolną z -s.",
        },
        "one-off-runs": {
          title: "Jednorazowo",
          body: "opencode run wysyła jedną wiadomość i wypisuje odpowiedź.",
        },
        "agents-and-commands": {
          title: "Agenci i polecenia",
          body: "Zmieniaj agentów przez shift+tab i otwieraj wszystkie polecenia przez ctrl+p.",
        },
        "auto-approve": {
          title: "Autozgoda",
          body: "Uruchom z --auto, aby zezwolić na każdą akcję, której nie zablokowałeś.",
        },
        "any-server": {
          title: "Każdy serwer",
          body: "Połącz się z serwerem OpenCode przez URL z --server.",
        },
        "usage-stats": {
          title: "Statystyki",
          body: "opencode stats pokazuje statystyki użycia do udostępnienia.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Pisz zwykłymi słowami",
          body: "Wpisz, czego chcesz, a agent pokaże plan w trakcie pracy.",
        },
        "approve-what-runs": {
          title: "Zatwierdzaj polecenia",
          body: "Edycje wyświetlają się jako diffy, a polecenia czekają na Twoją zgodę.",
        },
        "make-it-yours": {
          title: "Po swojemu",
          body: "Zmieniaj motyw jednym klawiszem, od domyślnego po tokyonight i inne.",
        },
        mini: {
          title: "Mini",
          body: "Uruchom opencode mini, a odpowiedzi trafią do historii terminala.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript dla skryptów, zadań CI i narzędzi",
      description:
        "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi. Typowany klient TypeScript tworzy sesje, wysyła prompty i strumieniuje każde zdarzenie na bieżąco.",
      intro:
        "Steruj OpenCode z własnych skryptów, zadań CI i narzędzi. SDK uruchamia OpenCode w Twoim procesie, z Twoją konfiguracją i modelami, a typowany klient tworzy sesje, wysyła prompty i strumieniuje każde zdarzenie.",
      features: {
        "typescript-client": {
          title: "Klient TypeScript",
          body: "Typowane żądania i zdarzenia, z tymi samymi wartościami co @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sesje z kodu",
          body: "Twórz sesje i wysyłaj prompty z dowolnego skryptu.",
        },
        "any-model": {
          title: "Każdy model",
          body: "Używa modeli skonfigurowanych w Twoim OpenCode.",
        },
        "npm-or-bun": {
          title: "npm lub bun",
          body: "Zainstaluj przez npm i @opencode/sdk lub bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host w procesie",
          body: "Uruchamia OpenCode w pamięci, bez ruchu sieciowego.",
        },
        "your-plugins": {
          title: "Twoje pluginy",
          body: "Przekaż własne pluginy przy tworzeniu hosta w procesie.",
        },
        "promise-or-effect": {
          title: "Promise lub Effect",
          body: "API Promise i API Effect z tymi samymi wartościami.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Uruchamiaj OpenCode w Durable Object Cloudflare na Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Napraw CI z kodu",
          body: "Skrypt prosi OpenCode o naprawę nieudanych testów i uruchamia je ponownie.",
        },
        "follow-every-step": {
          title: "Śledź każdy krok",
          body: "Strumieniuj zdarzenia, by na bieżąco widzieć każde narzędzie, którego używa agent.",
        },
        "build-your-own-tools": {
          title: "Własne narzędzia",
          body: "Podłącz OpenCode do botów, dashboardów i workflowów w kilku linijkach.",
        },
        "in-your-process": {
          title: "W Twoim procesie",
          body: "Uruchamia OpenCode w Twoim procesie, z Twoją konfiguracją i modelami.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, minimalny interfejs terminalowy dla agenta",
      description:
        "Mini uruchamia OpenCode w minimalnym interfejsie terminalowym. Odpowiedzi trafiają do historii terminala, a na dole zostają tylko prompt i linia statusu.",
      intro:
        "Minimalny interfejs terminalowy dla OpenCode. Uruchom opencode mini, a odpowiedzi trafią prosto do historii Twojego terminala, więc przewijasz, wyszukujesz i kopiujesz je jak każde inne wyjście. Na dole zostają tylko prompt i linia statusu.",
      features: {
        "your-scrollback": {
          title: "Twoja historia",
          body: "Odpowiedzi stają się zwykłą historią terminala.",
        },
        "one-prompt": {
          title: "Jeden prompt",
          body: "Agent, model, kontekst i koszt w jednej linii statusu.",
        },
        permissions: {
          title: "Uprawnienia",
          body: "Zezwalaj na edycje i polecenia z obszaru promptu.",
        },
        "how-much-shows": {
          title: "Ile widać",
          body: "Cicho, domyślnie lub wszystko, dla myślenia i wyjścia narzędzi.",
        },
        "pick-up-later": {
          title: "Wróć później",
          body: "Kontynuuj ostatnią sesję z -c albo dowolną z -s.",
        },
        "same-opencode": {
          title: "Ten sam OpenCode",
          body: "Ten sam serwer, agenci i modele co w innych aplikacjach.",
        },
        agents: {
          title: "Agenci",
          body: "Zmieniaj agentów prosto z promptu.",
        },
        compact: {
          title: "Skracanie",
          body: "Skróć długą sesję poleceniem /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Rozszerzenia",
    body: "Używaj OpenCode w VS Code albo w Zedzie i innych edytorach przez ACP.",
    action: "Instaluj",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "Pozwól agentom korzystać z Twojej przeglądarki.",
      title: "OpenCode | Browse, Twoja prawdziwa przeglądarka dla agentów",
      description:
        "Browse pozwala OpenCode i innym klientom MCP korzystać z Twojej prawdziwej przeglądarki. Agenci sterują kartami w tle przez Playwright i oddają Ci logowanie i 2FA.",
      intro:
        "Serwer MCP i rozszerzenie Chromium, dzięki którym agenci korzystają z Twojej prawdziwej przeglądarki, z Twoimi kartami, logowaniami i rozszerzeniami. Otwierają karty i sterują nimi przez Playwright, robią zrzuty ekranu i nagrywają ekran w kartach w tle, zgrupowanych tak, by Ci nie przeszkadzały. Gdy przychodzi Twoja kolej, przy logowaniu, kodzie 2FA czy płatności, oddają Ci kartę i działają dalej, gdy klikniesz Continue.",
      features: {
        "your-real-browser": {
          title: "Twoja przeglądarka",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera i Chromium.",
        },
        "out-of-your-way": {
          title: "Nie przeszkadza",
          body: "Karty agentów otwierają się w tle, w zwiniętych grupach.",
        },
        handoffs: {
          title: "Przekazanie",
          body: "Zaloguj się lub przejdź 2FA samodzielnie, potem kliknij Continue.",
        },
        "lend-a-tab": {
          title: "Użycz karty",
          body: "Kliknij przycisk na pasku, aby przekazać agentowi otwartą kartę.",
        },
        "record-and-capture": {
          title: "Nagrania",
          body: "Zrzuty ekranu, nagrania ekranu i ruch sieciowy jako HAR.",
        },
        "any-mcp-client": {
          title: "Każdy klient MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed i wiele innych.",
        },
        "all-your-logins": {
          title: "Wszystkie twoje logowania",
          body: "Agenci korzystają ze stron, na których już jesteś zalogowany. Bez kluczy, bez konfiguracji.",
        },
        allowlists: {
          title: "Listy stron",
          body: "Ogranicz karty sesji do wskazanych przez Ciebie stron.",
        },
      },
      install:
        "Najpierw zainstaluj [rozszerzenie Chrome]. Przeprowadzi cię przez pozostałe kroki. Aby zainstalować CLI bezpośrednio (nie powinno to być potrzebne), użyj jednego z tych poleceń.",
    },
  },
  apps: {
    browse: {
      category: "Sterowanie przeglądarką dla agentów",
      body: "Pozwól agentowi korzystać z Twojej prawdziwej przeglądarki, z Twoimi logowaniami i kartami.",
    },
    hex: {
      category: "Dyktowanie głosowe",
      body: "Dyktowanie głosowe na urządzeniu w każdej aplikacji.",
    },
    opentunnel: {
      category: "Tunele lokalne",
      body: "Publiczne adresy HTTPS dla lokalnych aplikacji.",
    },
    opentui: {
      category: "Biblioteka",
      body: "Biblioteka do interfejsów terminalowych.",
    },
  },
  getStarted: {
    title: "Zacznij",
    lead: "Najprościej zacząć, gdy pobierzesz OpenCode i użyjesz darmowych modeli. Konto nie jest potrzebne. Jeśli chcesz więcej, użyj własnej subskrypcji albo OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "pobierzesz OpenCode",
      },
      "free-models": {
        text: "darmowych modeli",
      },
      "your-own-subscription": {
        text: "własnej subskrypcji",
      },
      "a-subscription-you-already-have": {
        text: "subskrypcji, którą już masz",
      },
      "opencode-go": {
        text: "OpenCode Go",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
      "github-copilot": {
        name: "GitHub Copilot",
      },
    },
    plans: {
      "opencode-go": {
        name: "OpenCode Go",
      },
      "opencode-go-plus": {
        name: "OpenCode Go Plus",
      },
    },
    steps: {
      download: {
        title: "Pobierz",
        line: "Desktop, terminal lub telefon.",
      },
      "use-free-models": {
        title: "Darmowe modele",
        line: "OpenCode ma zestaw darmowych modeli. Konto nie jest potrzebne.",
      },
      "add-more-models": {
        title: "Więcej modeli",
        line: "Użyj własnej subskrypcji albo wybranych modeli OpenCode Go od 10 $ miesięcznie.",
      },
    },
    sentence:
      "Pobierz OpenCode, zacznij od darmowych modeli, a gdy zechcesz więcej, użyj własnej subskrypcji lub OpenCode Go.",
  },
  byos: {
    title: "Własne subskrypcje",
    headline: "Używaj subskrypcji, które już masz.",
    line: "Zaloguj się przez ChatGPT Plus lub Pro albo GitHub Copilot. Możesz też wybrać subskrypcję OpenCode.",
    yours: {
      label: "Twoja subskrypcja",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
        "github-copilot": {
          name: "GitHub Copilot",
        },
      },
    },
    planLinks: ["subskrypcję OpenCode", "OpenCode Go"],
    ours: {
      label: "Plany OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Zasady dla agenta",
        copied: "Skopiowano",
      },
    },
    naming: {
      title: "Nazwa",
      body: "Pisz OpenCode jako jedno słowo, z wielkim O i wielkim C. Nie pisz Opencode, Open Code, OpenCode AI ani Open-Code.",
      code: "Małych liter `opencode` używaj tylko w kodzie i nazwach pakietów, takich jak `opencode-figma` czy `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Samo logo, do ikon aplikacji, awatarów i innych małych miejsc. Wersje kwadratowe mają margines dla miejsc, które przycinają do kwadratu.",
        assets: {
          light: {
            name: "Jasne",
          },
          dark: {
            name: "Ciemne",
          },
          "square-light": {
            name: "Kwadrat, jasne",
          },
          "square-dark": {
            name: "Kwadrat, ciemne",
          },
        },
      },
      wordmark: {
        title: "Logotyp",
        body: "Pełna nazwa zapisana literami OpenCode. Używaj go wszędzie, gdzie jest miejsce na całą nazwę.",
        assets: {
          light: {
            name: "Jasny",
          },
          dark: {
            name: "Ciemny",
          },
        },
      },
      "simple-wordmark": {
        title: "Prosty logotyp",
        body: "Jednokolorowa wersja logotypu, do druku, haftu i miejsc, które pozwalają tylko na jeden kolor.",
        assets: {
          light: {
            name: "Jasny",
          },
          dark: {
            name: "Ciemny",
          },
        },
      },
    },
    icons: {
      title: "Awatary",
      body: "Kwadratowe awatary 1024px dla Slacka, Discorda, GitHuba i innych profili. Tło wypełnia cały kwadrat, a logo leży głęboko w okręgu, więc przetrwają okrągłe przycięcie.",
      items: {
        dark: {
          name: "Ciemny",
        },
        light: {
          name: "Jasny",
        },
      },
    },
    colors: {
      title: "Kolory",
      body: "Logo i logotyp używają jednego koloru w trzech stopniach krycia, z jaśniejszym kolorem na ciemne tła. Wartości poniżej to kolory użyte w standardowych plikach. Używaj ich wyłącznie w logo i logotypie, nie w innych tekstach ani tłach. Kliknij wartość, aby ją skopiować.",
      palettes: {
        light: {
          name: "Jasna",
          swatches: {
            ink: {
              name: "Kolor",
              use: "Obrys logo i litery „code”.",
            },
            "ink-70": {
              name: "Kolor 70%",
              use: "Litery „open”.",
              ink: "Kolor przy 70% krycia.",
            },
            "ink-20": {
              name: "Kolor 20%",
              use: "Wewnętrzny odcień logo.",
              ink: "Kolor przy 20% krycia.",
            },
          },
        },
        dark: {
          name: "Ciemna",
          swatches: {
            ink: {
              name: "Kolor",
              use: "Obrys logo i litery „code”.",
            },
            "ink-72": {
              name: "Kolor 72%",
              use: "Litery „open”.",
              ink: "Kolor przy 72% krycia.",
            },
            "ink-28": {
              name: "Kolor 28%",
              use: "Wewnętrzny odcień logo.",
              ink: "Kolor przy 28% krycia.",
            },
          },
        },
      },
    },
    variants: {
      title: "Warianty",
      body: "Wybierz wersję, przy której logo jest wyraźne na Twoim tle, ciemną na jasnych tłach i jasną na ciemnych. Logo i logotyp to osobne pliki, więc używaj jednego albo drugiego.",
      groups: {
        default: {
          name: "Domyślny",
          body: "Logo do użycia prawie wszędzie. Jego wewnętrzny odcień jest przezroczysty. Na bieli i czerni wygląda dokładnie jak dwutonowe szarości, a na zdjęciach, gradientach i kolorach prześwituje tło.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Ciemne",
                },
                light: {
                  name: "Jasne",
                },
              },
            },
            wordmark: {
              title: "Logotyp",
              tiles: {
                dark: {
                  name: "Ciemny",
                },
                light: {
                  name: "Jasny",
                },
              },
            },
          },
        },
        simple: {
          name: "Prosty",
          body: "Jeden kolor, z otwartymi światłami liter i bez wewnętrznego odcienia. Używaj go na płaskich kolorowych tłach, w druku jednokolorowym i wszędzie, gdzie nie możesz użyć szarości. Prosty ciemny na jasnych kolorach, prosty jasny na ciemnych.",
          rows: {
            wordmark: {
              title: "Logotyp",
              tiles: {
                dark: {
                  name: "Ciemny",
                },
                light: {
                  name: "Jasny",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Użycie",
      body: "Używaj jasnych wersji na jasnych tłach i ciemnych wersji na ciemnych tłach. Logo i logotyp są osobne. Używaj jednego albo drugiego, nigdy obu razem.",
      stroke: {
        title: "Jedna kreska",
        body: "Odstępy na tej stronie mierzymy w kreskach. Jedna kreska to grubość obrysu logo, czyli jedna czwarta jego szerokości, więc logo ma 4 kreski szerokości i 5 kresek wysokości.",
      },
      clearSpace: {
        title: "Margines",
        body: "Zostaw co najmniej dwie kreski odstępu z każdej strony logo i logotypu. W logo kreska to grubość obrysu, jedna czwarta szerokości. W logotypie to grubość liter, jedna siódma wysokości.",
      },
      pixels: {
        title: "Pełne piksele",
        body: "Proporcje logo są stałe, 4:5, a jedna kreska to jedna czwarta szerokości. Skaluj je co 4 × 5px, aby każda krawędź i każda kreska wypadała na pełnym pikselu.",
        do: "trzymaj każdą krawędź i kreskę 4px na pełnych pikselach.",
        dont: "zmieniaj proporcji 4:5, bo krawędzie wypadną między pikselami i się rozmyją.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotyp",
          },
        },
      },
      minimumTitle: "Minimalne rozmiary",
      minimum: {
        logo: {
          title: "Logo",
          body: "Co najmniej 16 × 20px, z kreską 4px. Mniejsze się rozmywa.",
        },
        wordmark: {
          title: "Logotyp",
          body: "Co najmniej 117 × 21px, z kreską 3px. Mniejszy się rozmywa.",
        },
      },
    },
    donts: {
      title: "Nie",
      body: "Częste błędy, których warto unikać przy używaniu logo i logotypu.",
      examples: {
        "two-tone": {
          caption: "zmieniaj kolorów logo na nowe.",
        },
        bright: {
          caption: "używaj jednego jaskrawego koloru.",
        },
        gradient: {
          caption: "wypełniaj logo gradientem.",
        },
        inverted: {
          caption: "zamieniaj odcieni miejscami.",
        },
        stretch: {
          caption: "rozciągaj ani nie spłaszczaj logo.",
        },
        shadow: {
          caption: "dodawaj cieni.",
        },
        glow: {
          caption: "dodawaj poświaty ani obrysów.",
        },
        lockup: {
          caption: "stawiaj innych słów obok logo.",
        },
        "low-contrast": {
          caption: "używaj szarego na szarym przy niskim kontraście.",
        },
        color: {
          caption: "kładź szarego dwutonowego logo na kolorowym tle, gdzie szarości stają się brudne.",
        },
      },
    },
    integrations: {
      title: "Integracje",
      body: "Pluginy, dostawcy i narzędzia, które działają z OpenCode, oraz projekty z jego użyciem mogą o tym mówić. Użyj odznaki albo lockupu partnerskiego i nazwij projekt tak, aby było jasne, że jest Twój.",
      badges: {
        body: "Umieść odznakę w README, dokumentacji lub na stronie i podlinkuj ją do opencode.ai. Wybierz plik jasny lub ciemny pod swoje tło (HTML przełącza się sam) i nie zmieniaj kolorów ani tekstu.",
        sizes: "Każdy styl jest w rozmiarach 20, 32 i 44px (Shields tylko 20px), jako SVG i PNG w 2×.",
        mono: "Każdy plik ma też wersję z tekstem OpenTUI Mono. Dodaj -mono przed rozszerzeniem, jak w opencode-works-with-a-light-20-mono.svg, albo -mono-caps dla OpenTUI Mono wielkimi literami.",
        groups: {
          "works-with": {
            title: "Działa z",
            alt: "Działa z OpenCode",
            body: "Dla pluginów, dostawców i narzędzi, które działają z OpenCode.",
          },
          "built-with": {
            title: "Zbudowane z",
            alt: "Zbudowane z OpenCode",
            body: "Dla projektów stworzonych z OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Ramka",
          },
          c: {
            name: "Komórki",
          },
          f: {
            name: "Pełny",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Lockup partnerski",
        body: "Ustaw logo OpenCode i logo partnera obok siebie, z × pomiędzy. Zostaw 3 kreski odstępu po obu stronach ×, dobierz rozmiar logo partnera tak, by wyglądało na tak wysokie jak logo OpenCode, i zachowaj wolną przestrzeń wokół całości.",
        partners: {
          github: {
            name: "GitHub",
          },
        },
      },
      naming: {
        title: "Nazwa projektu",
        body: "Zacznij od własnej nazwy, aby było jasne, że projekt jest Twój.",
        rule: "Pisz `Linear for OpenCode` albo nazwij pakiet `opencode-linear`. Nie pisz `OpenCode Linear` ani `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Znaki towarowe",
      body: "OpenCode i logo OpenCode są znakami towarowymi Anomaly. Nie używaj ich, aby sugerować, że Anomaly Cię popiera lub sponsoruje, w nazwie produktu czy firmy ani na gadżetach bez zgody.",
      contact: {
        before: "W razie pytań napisz na ",
        after: ".",
      },
    },
  },
  press: {
    title: "OpenCode | Materiały prasowe, fakty o firmie i zasoby marki",
    description:
      "Materiały prasowe OpenCode, z faktami o OpenCode i Anomaly, firmie, która za nim stoi, oraz logo i logotypami do pobrania i kontaktem dla prasy.",
    hero: {
      title: "Prasa",
      body: "Fakty, zasoby marki i kontakty dla piszących o OpenCode i Anomaly.",
    },
    company: {
      title: "O Anomaly",
      lead: "Anomaly to firma, która stoi za OpenCode. Tworzy narzędzia open source dla programistów.",
      more: "Inne projekty to między innymi SST i OpenTUI, wszystkie open source na [GitHubie](github).",
      learnMore: "Więcej informacji znajdziesz na [anoma.ly](site).",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "Open source'owy agent do programowania, z aplikacjami na desktop, terminal i telefon oraz SDK. Licencja MIT, ponad 220 000 gwiazdek na GitHubie.",
        },
        sst: {
          name: "SST",
          body: "Framework do budowania aplikacji full-stack na własnej infrastrukturze. Licencja MIT, otwarty od 2020 roku, ponad 26 000 gwiazdek na GitHubie.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Biblioteka do interfejsów terminalowych w TypeScript, React lub Solid, z rdzeniem w Zig. OpenCode używa jej produkcyjnie. Ponad 13 000 gwiazdek na GitHubie.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "Otwarta baza specyfikacji, cen i możliwości modeli AI, z publicznym API. Zawiera ponad 8900 modeli od ponad 200 dostawców.",
        },
        hex: {
          name: "Hex",
          body: "Dyktowanie głosowe na Maca, Windows i Linuksa. Hex transkrybuje na Twoim urządzeniu i wkleja do dowolnej aplikacji, więc dźwięk nigdy go nie opuszcza.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "CLI i SDK, które dają aplikacjom na Twojej maszynie publiczny adres HTTPS. TLS kończy się na Twojej maszynie, więc przekaźnik nigdy nie widzi jawnego tekstu.",
        },
      },
    },
    about: {
      title: "O OpenCode",
      body: "Opisy OpenCode i jego produktów w wersji długiej i krótkiej, gotowe do skopiowania.",
      boilerplate: {
        long: "OpenCode to open source'owy agent do programowania. Jest dostępny jako aplikacja desktopowa, interfejs terminalowy, aplikacja mobilna i SDK, i działa z modelami dowolnego dostawcy, w tym Claude, GPT i Gemini. OpenCode ma licencję MIT i jest tworzony przez Anomaly. Ma ponad 220 000 gwiazdek na GitHubie i ponad 1000 współtwórców, a co miesiąc korzysta z niego ponad 22 miliony programistów.",
        short:
          "OpenCode to open source'owy agent do programowania od Anomaly, z aplikacjami na desktop, terminal i telefon oraz SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console to aplikacja webowa, w której programiści i zespoły kupują dostęp do modeli AI dla OpenCode i innych agentów do programowania oraz nim zarządzają. Oferuje inferencję pay-as-you-go dla modeli frontier i open-weight, rozliczaną za żądanie z przedpłaconych kredytów, oraz subskrypcje OpenCode Go. Zespoły dostają przestrzenie robocze z rolami Member, Admin i Owner, limity wydatków dla przestrzeni i użytkowników, logowanie jednokrotne przez Okta, Microsoft Entra ID lub Google Workspace oraz SCIM. Console obsługuje ponad 30 dostawców, więc zespoły mogą podłączyć konta, które już mają, a własna inferencja jest opcjonalna. Działa pod adresem opencode.ai/console.",
          short:
            "OpenCode Console to aplikacja webowa Anomaly do dostępu do modeli AI w modelu pay-as-you-go, subskrypcji OpenCode Go i kontroli zespołowych, takich jak budżety i logowanie jednokrotne.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go to subskrypcja dla programistów, którzy chcą stałej miesięcznej ceny za modele do programowania. Go kosztuje 10 $ miesięcznie, Go Plus 40 $ miesięcznie z wyższymi limitami, a Go Teams 20 $ miesięcznie za członka. Każdy plan obejmuje wybrany zestaw modeli przetestowanych pod kątem programowania z agentami. Limity użycia to miesięczne kwoty w dolarach dla każdego modelu, z kroczącymi limitami 5-godzinnymi i tygodniowymi wynoszącymi 20% i 50% limitu miesięcznego. Subskrybenci mogą doładować kredyty, przejść na saldo pay-as-you-go i zrezygnować w każdej chwili. Go działa z OpenCode i innymi agentami. Działa pod adresem opencode.ai/console/go.",
          short:
            "OpenCode Go to miesięczna subskrypcja od Anomaly, która daje programistom miesięczne limity użycia wybranego zestawu modeli do programowania, od 10 $ miesięcznie.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data to publiczny dashboard, który pokazuje, jakich modeli AI programiści używają w OpenCode i jak ta struktura zmienia się w czasie. Publikuje ranking najpopularniejszych modeli, zużycie tokenów, koszty sesji i tokenów, współczynniki cache, udziały w rynku i podział na kraje. Dane są agregowane co godzinę, z dniami i tygodniami w UTC. Liczby użytkowników i sesji są przybliżone, a koszty opierają się na cenach katalogowych z katalogu modeli OpenCode. Dziennikarze mogą cytować go jako OpenCode Data (opencode.ai/data) z godziną aktualizacji podaną na stronie.",
          short:
            "OpenCode Data to publiczny dashboard pod adresem opencode.ai/data, który szereguje modele AI według rzeczywistego użycia w OpenCode, z tokenami, kosztami i udziałami w rynku aktualizowanymi co godzinę.",
        },
      },
    },
    facts: {
      title: "W skrócie",
      items: {
        license: {
          label: "Licencja",
        },
        "first-release": {
          label: "Pierwsze wydanie",
        },
        "made-by": {
          label: "Twórca",
        },
      },
    },
    milestones: {
      title: "Etapy",
      items: {
        "first-release-v0-0-1": {
          date: "Kwi 2025",
          text: "Pierwsze wydanie, v0.0.1",
        },
        "1-million-downloads": {
          date: "Paź 2025",
          text: "1 mln+ pobrań",
        },
        "opencode-1-0": {
          date: "Paź 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Gru 2025",
          text: "Premiera Desktop",
        },
        "10-million-downloads": {
          date: "Sty 2026",
          text: "10 mln+ pobrań",
        },
        "opencode-2-0": {
          date: "Wrz 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Lis 2026",
          text: "220 000+ gwiazdek",
        },
      },
    },
    news: {
      title: "Najnowsze wydania",
      intro: "OpenCode wydaje nowe wersje często. Oto najnowsze wydania z nowymi funkcjami.",
      changelog: {
        text: "Dziennik zmian",
      },
      feed: {
        text: "Kanał RSS",
      },
    },
    media: {
      title: "Media",
      intro:
        "Zrzuty i krótkie filmy każdej aplikacji, nagrane z prawdziwego produktu. Możesz ich używać, pisząc o OpenCode.",
      note: "Wszystkie nagrania używają ciemnego motywu. Zrzuty i okładki to pliki JPG do 1920 × 1080 lub 1080 × 1350 w pionie. Filmy to klipy MP4 bez dźwięku.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Film Desktop",
            },
            "frame-1": {
              title: "Zrzut Desktop 1",
            },
            "frame-2": {
              title: "Zrzut Desktop 2",
            },
            "frame-3": {
              title: "Zrzut Desktop 3",
            },
            "frame-4": {
              title: "Zrzut Desktop 4",
            },
            "feature-1": {
              title: "Sesje w kartach",
            },
            "feature-2": {
              title: "Przeglądaj i komentuj",
            },
            "feature-3": {
              title: "Zobacz w przeglądarce",
            },
            "locked-portrait": {
              title: "Film Desktop, pion",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Film Mobile",
            },
            "frame-1": {
              title: "Zrzut Mobile 1",
            },
            "frame-2": {
              title: "Zrzut Mobile 2",
            },
            "frame-3": {
              title: "Zrzut Mobile 3",
            },
            "feature-1": {
              title: "Głos",
            },
            "feature-2": {
              title: "Zgody",
            },
            "feature-3": {
              title: "Sesje",
            },
            "locked-portrait": {
              title: "Film Mobile, pion",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Film Terminal",
            },
            "frame-1": {
              title: "Zrzut Terminal 1",
            },
            "frame-2": {
              title: "Zrzut Terminal 2",
            },
            "frame-3": {
              title: "Zrzut Terminal 3",
            },
            "frame-4": {
              title: "Zrzut Terminal 4",
            },
            "feature-1": {
              title: "Pisz zwykłymi słowami",
            },
            "feature-2": {
              title: "Zatwierdzaj polecenia",
            },
            "feature-3": {
              title: "Po swojemu",
            },
            "locked-portrait": {
              title: "Film Terminal, pion",
            },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": {
              title: "Film SDK",
            },
            "frame-1": {
              title: "Zrzut SDK 1",
            },
            "frame-2": {
              title: "Zrzut SDK 2",
            },
            "frame-3": {
              title: "Zrzut SDK 3",
            },
            "frame-4": {
              title: "Zrzut SDK 4",
            },
            "feature-1": {
              title: "Napraw CI z kodu",
            },
            "feature-2": {
              title: "Śledź każdy krok",
            },
            "feature-3": {
              title: "Własne narzędzia",
            },
            "locked-portrait": {
              title: "Film SDK, pion",
            },
          },
        },
      },
    },
    people: {
      title: "Ludzie",
    },
    anomalyLogo: {
      title: "Logo Anomaly",
      body: "Znak i logotyp Anomaly, w czerni i bieli. Pliki PNG mają 2048 px szerokości.",
      assets: {
        "mark-black": {
          name: "Znak, czarny",
        },
        "mark-white": {
          name: "Znak, biały",
        },
        "wordmark-black": {
          name: "Logotyp, czarny",
        },
        "wordmark-white": {
          name: "Logotyp, biały",
        },
      },
      all: {
        text: "Pobierz wszystko",
      },
    },
    coverage: {
      title: "W mediach",
    },
    brand: {
      title: "Marka",
      before:
        "Pobierz logo i logotypy OpenCode w jednym pliku ZIP. Pojedyncze pliki, warianty i zasady użycia znajdziesz na ",
      link: {
        text: "stronie marki",
      },
      after: ".",
      usage:
        "Możesz używać tych plików, pisząc o OpenCode. Nie zmieniaj ich i nie sugeruj, że OpenCode popiera Twoją pracę.",
    },
    product: {
      title: "Produkt",
      items: {
        desktop: {
          name: "Desktop",
          body: "Uruchamiaj kilku agentów naraz, każdego w osobnej karcie, na macOS, Windows i Linux. Przeglądaj każdą zmianę jako diff i oglądaj podgląd.",
        },
        mobile: {
          name: "Mobile",
          body: "Najnowsza aplikacja OpenCode. Zadzwoń do sesji, aby porozmawiać z agentem, a potem przeglądaj i zatwierdzaj jego zmiany z telefonu, gdziekolwiek jesteś.",
        },
        terminal: {
          name: "Terminal",
          body: "Interfejs terminalowy, który działa w każdej powłoce, edytorze i na zdalnym serwerze. Oglądaj każdą edycję jako diff i wybieraj, które polecenia uruchamiają się same.",
        },
        sdk: {
          name: "SDK",
          body: "Typowany klient TypeScript dla skryptów, zadań CI i Twoich narzędzi. Twórz sesje, wysyłaj prompty i strumieniuj każde zdarzenie na bieżąco.",
        },
      },
    },
    contact: {
      title: "Kontakt",
      items: {
        press: {
          title: "Prasa",
          body: "Dla dziennikarzy i analityków. Odpowiadamy tylko na zapytania mediów.",
        },
        support: {
          title: "Wsparcie",
          body: "Jeśli potrzebujesz pomocy z OpenCode, zgłoś issue lub zapytaj społeczność. W sprawach konta i płatności napisz do nas.",
          links: {
            "github-issues": {
              text: "Zgłoszenia GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Bezpieczeństwo",
          body: "Zgłoś podatność przez GitHub. Jeśli nikt nie odpowie w ciągu 6 dni roboczych, napisz do nas.",
          links: {
            "report-a-vulnerability": {
              text: "Zgłoś podatność",
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
          device: "Android",
        },
      },
    },
    terminal: {
      title: "Terminal",
      installs: {
        curl: {
          name: "Skrypt",
        },
      },
    },
    extensions: {
      title: "Rozszerzenia",
      items: {
        "vs-code": {
          label: "VS Code",
        },
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
        label: "Czytaj dokumentację SDK",
      },
    },
    mini: {
      lead: "Mini jest częścią OpenCode CLI. Zainstaluj go dowolnym z tych sposobów, a potem uruchom opencode mini.",
      commands: {
        curl: {
          name: "Skrypt",
        },
      },
    },
    terminal: {
      commands: {
        curl: {
          name: "Skrypt",
        },
      },
    },
  },
  pair: {
    title: "Połącz telefon",
    cardTitle: "Sparuj telefon jednym poleceniem",
    intro:
      "OpenCode Mobile to pilot do OpenCode na Twoim komputerze. Sesje działają dalej na komputerze, a aplikacja je pokazuje i pozwala nimi sterować.",
    steps: {
      "get-the-app": {
        title: "Pobierz aplikację",
        body: "Zainstaluj betę OpenCode na iPhonie z TestFlight. Aplikacja na Androida pojawi się wkrótce.",
      },
      "run-this-on-your-computer": {
        title: "Uruchom to na komputerze",
        body: "Polecenie wypisze jednorazowy link i kod QR. Działają raz i wygasają po 5 minutach.",
      },
      "scan-the-code": {
        title: "Zeskanuj kod",
        body: "Zeskanuj kod QR w aplikacji albo wklej link. Ostatnie sesje z komputera otworzą się na telefonie.",
      },
    },
    note: "--remote łączy się przez adres OpenTunnel, więc działa z każdej sieci. W tej samej sieci Wi-Fi uruchom raz opencode service set hostname 0.0.0.0, a potem opencode pair.",
    facts: [
      "Parowanie działa z każdej sieci, bo --remote łączy się przez adres OpenTunnel.",
      "Link i kod działają raz i wygasają po 5 minutach.",
      "Komputer musi być włączony, bo agent działa na nim, a nie na telefonie.",
      "W tej samej sieci Wi-Fi uruchom raz opencode service set hostname 0.0.0.0, a potem opencode pair.",
    ],
  },
} satisfies ContentOverlay
