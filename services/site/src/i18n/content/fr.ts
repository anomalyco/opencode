import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessions, onglets, diffs, navigateur intégré et extensions sur macOS, Windows et Linux.",
      action: "Télécharger",
    },
    mobile: {
      name: "Mobile",
      body: "Lancez, pilotez et approuvez des sessions depuis votre téléphone, où que vous soyez.",
      action: "Télécharger",
    },
    terminal: {
      name: "Terminal",
      body: "Une interface terminal rapide, dans tous les shells et éditeurs, même sur un serveur distant.",
      action: "Installer",
    },
    sdk: {
      body: "Pilotez OpenCode depuis vos scripts, vos tâches CI et vos outils.",
      action: "Lire la doc",
    },
    mini: {
      body: "Une interface terminal épurée. Les réponses défilent dans votre historique. Seul le prompt reste en dessous.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Application Desktop pour macOS, Windows et Linux",
      description:
        "Faites tourner autant d’agents OpenCode que vous voulez en parallèle, suivez chaque modification dans le navigateur à leurs côtés et reprenez vos sessions sur n’importe quel appareil. Pour macOS, Windows et Linux.",
      intro:
        "Lancez plusieurs agents en parallèle, une session par onglet. Examinez chaque diff, commentez n’importe quelle ligne et vérifiez le résultat dans le navigateur intégré. Pour macOS, Windows et Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agents en parallèle",
          body: "Lancez autant d’agents que vous le souhaitez en parallèle. Passez de l’un à l’autre à mesure qu’ils terminent.",
        },
        "see-it-in-the-browser": {
          title: "À voir dans le navigateur",
          body: "Votre application s’ouvre dans un navigateur à côté de l’agent. Vous voyez tous les deux chaque modification prendre effet.",
        },
        "on-every-device": {
          title: "Sur tous vos appareils",
          body: "Lancez des agents sur tous vos appareils et reprenez vos sessions dans Desktop, dans le terminal ou sur votre téléphone.",
        },
        "extend-it": {
          title: "Ajoutez vos extensions",
          body: "Connectez vos outils et services pour que l’agent puisse s’en servir. OpenCode peut aussi créer ses propres plugins, avec leur interface dans la barre latérale.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, vos sessions de code sur votre téléphone",
      description:
        "Lancez et pilotez vos sessions OpenCode depuis votre téléphone. Parlez à l’agent pendant qu’il travaille sur votre ordinateur.",
      intro:
        "Lancez et pilotez vos sessions depuis votre téléphone, où que vous soyez. Appelez une session pour parler à l’agent, ou rouvrez n’importe quelle session pour reprendre là où vous en étiez. OpenCode continue de tourner sur votre propre ordinateur.",
      showcase: {
        voice: {
          title: "Voix",
          body: "Appelez une session et dites ce dont vous avez besoin. L’agent vous répond à voix haute.",
        },
        sessions: {
          title: "Sessions",
          body: "Ouvrez n’importe quelle session, voyez où elle en est et reprenez là où vous l’avez laissée.",
        },
        results: {
          title: "Résultats",
          body: "Une fois le travail terminé, vous apprenez pendant l’appel ce qui a changé.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interface terminal de l’agent de code open source",
      description:
        "Une interface terminal rapide pour OpenCode, compatible avec tous les shells, éditeurs et serveurs distants. Décrivez ce que vous voulez, examinez chaque diff et approuvez les commandes.",
      intro:
        "Une interface terminal rapide, compatible avec tous les shells, éditeurs et serveurs distants. Décrivez ce que vous voulez avec vos mots, suivez chaque diff et choisissez les commandes qui peuvent s’exécuter automatiquement.",
      features: {
        "any-terminal": {
          title: "Tout terminal",
          body: "Fonctionne dans tout shell, dans le terminal de votre éditeur ou sur un serveur distant.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs dans le fil",
          body: "Chaque diff apparaît dans le fil au moment où l’agent effectue la modification.",
        },
        "pick-up-later": {
          title: "Reprendre plus tard",
          body: "Reprenez la dernière session avec -c, ou n’importe laquelle avec -s.",
        },
        "one-off-runs": {
          title: "Exécutions ponctuelles",
          body: "opencode run envoie un message et affiche la réponse.",
        },
        "agents-and-commands": {
          title: "Agents et commandes",
          body: "Changez d’agent avec shift+tab et ouvrez toutes les commandes avec ctrl+p.",
        },
        "auto-approve": {
          title: "Approbation automatique",
          body: "Lancez avec --auto pour autoriser toute action que vous n’avez pas refusée.",
        },
        "any-server": {
          title: "Tout serveur",
          body: "Connectez-vous à un serveur OpenCode par URL avec --server.",
        },
        "usage-stats": {
          title: "Statistiques d’utilisation",
          body: "opencode stats affiche les statistiques d’utilisation que vous pouvez partager.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Formulez votre demande",
          body: "Écrivez ce que vous voulez. L’agent affiche son plan pendant qu’il travaille.",
        },
        "approve-what-runs": {
          title: "Validez les commandes",
          body: "Les modifications s’affichent sous forme de diffs. Les commandes attendent votre autorisation.",
        },
        "make-it-yours": {
          title: "À votre image",
          body: "Changez de thème d’une touche, du thème par défaut à tokyonight et bien d’autres.",
        },
        mini: {
          title: "Mini",
          body: "Lancez opencode mini pour voir les réponses dans l’historique de défilement de votre terminal.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript pour vos scripts, tâches CI et outils",
      description:
        "Pilotez OpenCode depuis vos scripts, vos tâches CI et vos outils. Le client TypeScript typé crée des sessions, envoie des prompts et transmet chaque événement en temps réel.",
      intro:
        "Pilotez OpenCode depuis vos scripts, vos tâches CI et vos outils. Le SDK exécute OpenCode dans votre processus avec votre configuration et vos modèles. Son client typé crée des sessions, envoie des prompts et transmet chaque événement.",
      features: {
        "typescript-client": {
          title: "Client TypeScript",
          body: "Requêtes et événements typés, avec les mêmes valeurs que @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessions depuis le code",
          body: "Créez des sessions et envoyez des prompts depuis n’importe quel script.",
        },
        "any-model": {
          title: "Tout modèle",
          body: "Utilise les modèles configurés dans OpenCode.",
        },
        "npm-or-bun": {
          title: "npm ou bun",
          body: "Installez-le avec npm i @opencode/sdk ou bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Hôte dans votre processus",
          body: "Exécute OpenCode en mémoire, sans passer par le réseau.",
        },
        "your-plugins": {
          title: "Vos plugins",
          body: "Ajoutez vos plugins à la création de l’hôte dans votre processus.",
        },
        "promise-or-effect": {
          title: "Promise ou Effect",
          body: "Une API Promise et une API Effect, avec les mêmes valeurs.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Exécutez OpenCode dans un Cloudflare Durable Object sur Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Corriger la CI par le code",
          body: "Un court script demande à OpenCode de corriger les tests en échec, puis les relance.",
        },
        "follow-every-step": {
          title: "Suivre chaque étape",
          body: "Recevez les événements en continu et voyez en temps réel quels outils l’agent appelle.",
        },
        "build-your-own-tools": {
          title: "Créez vos outils",
          body: "Intégrez OpenCode à vos bots, tableaux de bord et processus en quelques lignes de code.",
        },
        "in-your-process": {
          title: "Dans votre processus",
          body: "Exécute OpenCode dans votre processus, avec votre configuration et vos modèles.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, l’interface terminal épurée de l’agent",
      description:
        "Mini exécute OpenCode dans une interface terminal épurée. Les réponses s’affichent dans l’historique de défilement du terminal. Seuls un prompt et une ligne d’état restent en bas.",
      intro:
        "L’interface terminal épurée d’OpenCode. Lancez opencode mini pour afficher les réponses directement dans l’historique de défilement de votre terminal. Vous pouvez les faire défiler, les rechercher et les copier comme n’importe quelle sortie. Seuls le prompt et une ligne d’état restent en bas.",
      features: {
        "your-scrollback": {
          title: "Votre historique de défilement",
          body: "Les réponses s’ajoutent à l’historique du terminal, comme toute autre sortie.",
        },
        "one-prompt": {
          title: "Un seul prompt",
          body: "Agent, modèle, contexte et coût sur une ligne d’état.",
        },
        permissions: {
          title: "Autorisations",
          body: "Autorisez les modifications et les commandes depuis la zone de prompt.",
        },
        "how-much-shows": {
          title: "Niveau de détail",
          body: "Affichez plus ou moins de détails sur le raisonnement et la sortie des outils : mode discret, par défaut ou complet.",
        },
        "pick-up-later": {
          title: "Reprendre plus tard",
          body: "Reprenez la dernière session avec -c, ou n’importe laquelle avec -s.",
        },
        "same-opencode": {
          title: "Le même OpenCode",
          body: "Le même serveur, les mêmes agents et les mêmes modèles que dans les autres applications.",
        },
        agents: {
          title: "Agents",
          body: "Changez d’agent directement depuis le prompt.",
        },
        compact: {
          title: "Compacter",
          body: "Compactez une longue session avec /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensions",
    body: "Utilisez OpenCode dans VS Code, ou dans Zed et d’autres éditeurs via ACP.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "Laissez les agents utiliser votre navigateur habituel.",
      title: "OpenCode | Browse, votre navigateur au service de vos agents de code",
      description:
        "Browse permet à OpenCode et aux autres clients MCP d’utiliser votre navigateur habituel. Les agents lisent les pages, cliquent, saisissent du texte, prennent des captures d’écran et enregistrent des onglets. Ils vous rendent la main pour les connexions et la 2FA.",
      intro:
        "Un serveur MCP et une extension Chromium permettent à vos agents d’utiliser votre navigateur habituel, avec vos onglets, vos connexions et vos extensions. Ils ouvrent des groupes d’onglets en arrière-plan pour ne pas vous gêner. Ils lisent les pages, cliquent, saisissent du texte, prennent des captures d’écran et enregistrent des onglets. Pour une connexion, une étape 2FA ou un paiement, ils vous rendent l’onglet et reprennent quand vous cliquez sur Continue.",
      features: {
        "your-real-browser": {
          title: "Votre navigateur habituel",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera et Chromium.",
        },
        "out-of-your-way": {
          title: "En arrière-plan",
          body: "Les onglets des agents s’ouvrent en arrière-plan, dans des groupes repliés.",
        },
        handoffs: {
          title: "Reprenez la main",
          body: "Connectez-vous ou effectuez vous-même l’étape 2FA, puis cliquez sur Continue.",
        },
        "lend-a-tab": {
          title: "Confiez un onglet",
          body: "Cliquez sur le bouton de la barre d’outils pour confier à un agent un onglet que vous avez ouvert.",
        },
        "record-and-capture": {
          title: "Enregistrer et capturer",
          body: "Captures d’écran, enregistrements d’onglets et trafic réseau.",
        },
        "any-mcp-client": {
          title: "Tout client MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed et bien d’autres.",
        },
        "all-your-logins": {
          title: "Vos connexions actives",
          body: "Les agents accèdent aux sites sur lesquels vous êtes déjà connecté. Ni clé ni configuration.",
        },
        "allowed-sites": {
          title: "Sites autorisés",
          body: "Limitez l’onglet de l’agent aux sites que vous indiquez.",
        },
      },
      install:
        "Installez d’abord l’[extension Chrome]. Elle vous guide pour la suite. Si vous souhaitez installer la CLI directement, ce qui n’est normalement pas nécessaire, utilisez l’une de ces commandes.",
    },
  },
  apps: {
    browse: {
      category: "Contrôle du navigateur pour agents",
      body: "Laissez votre agent utiliser votre navigateur habituel, avec vos connexions et vos onglets.",
    },
    opentunnel: {
      category: "Tunnels locaux",
      body: "Des URL HTTPS publiques pour vos applications locales.",
    },
    opentui: {
      category: "Bibliothèque",
      body: "Une bibliothèque d’interfaces utilisateur pour le terminal.",
    },
    hex: {
      category: "Dictée vocale",
      body: "Dictée vocale en local, dans toutes vos applications.",
    },
  },
  getStarted: {
    title: "Démarrer",
    lead: "Pour démarrer, téléchargez OpenCode et utilisez les modèles gratuits, sans compte. Pour accéder à plus de modèles, utilisez un abonnement que vous avez déjà ou choisissez OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "télécharger OpenCode",
      },
      "free-models": {
        text: "modèles gratuits",
      },
      "your-own-subscription": {
        text: "votre propre abonnement",
      },
      "a-subscription-you-already-have": {
        text: "un abonnement que vous avez déjà",
      },
    },
    subscriptions: {
      "chatgpt-plus-pro": {
        name: "ChatGPT Plus/Pro",
      },
    },
    steps: {
      download: {
        title: "Télécharger",
        line: "Desktop, terminal ou mobile.",
      },
      "use-free-models": {
        title: "Utiliser les modèles gratuits",
        line: "OpenCode inclut des modèles gratuits. Aucun compte requis.",
      },
      "add-more-models": {
        title: "Ajouter des modèles",
        line: "Utilisez votre abonnement ou choisissez la sélection de modèles d’OpenCode Go dès 10 $ par mois.",
      },
    },
    sentence:
      "Téléchargez OpenCode et commencez avec les modèles gratuits. Pour aller plus loin, utilisez votre propre abonnement ou choisissez OpenCode Go.",
  },
  byos: {
    title: "Gardez votre abonnement",
    headline: "Utilisez les abonnements que vous avez déjà.",
    line: "Connectez-vous avec ChatGPT Plus ou Pro, ou GitHub Copilot. Vous pouvez aussi choisir un abonnement OpenCode.",
    yours: {
      label: "Votre abonnement",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
      },
    },
    planLinks: ["abonnement OpenCode"],
    ours: {
      label: "Offres OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Règles pour l’agent",
        copied: "Règles copiées",
      },
    },
    naming: {
      title: "Nom",
      body: "Écrivez OpenCode en un seul mot, avec un O et un C majuscules. N’écrivez pas Opencode, Open Code, OpenCode AI ou Open-Code.",
      code: "Utilisez `opencode` en minuscules uniquement dans le code et les noms de paquets, comme `opencode-figma` ou `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Le logo seul convient aux icônes d’application, aux avatars et aux petits espaces. Les versions carrées prévoient une marge pour les recadrages au format carré.",
        assets: {
          light: {
            name: "Clair",
          },
          dark: {
            name: "Sombre",
          },
          "square-light": {
            name: "Carré, clair",
          },
          "square-dark": {
            name: "Carré, sombre",
          },
        },
      },
      wordmark: {
        title: "Logotype",
        body: "Le nom complet dans la typographie OpenCode. Choisissez ce logotype partout où vous avez la place d’afficher le nom en entier.",
        assets: {
          light: {
            name: "Clair",
          },
          dark: {
            name: "Sombre",
          },
        },
      },
      "simple-wordmark": {
        title: "Logotype simple",
        body: "Une version monochrome du logotype, pour l’impression, la broderie et les endroits qui n’acceptent qu’une couleur.",
        assets: {
          light: {
            name: "Clair",
          },
          dark: {
            name: "Sombre",
          },
        },
      },
    },
    icons: {
      title: "Avatars",
      body: "Des avatars carrés de 1024 px pour Slack, Discord, GitHub et d’autres profils. Le fond remplit tout le carré. Le logo tient à l’intérieur du cercle et reste visible en cas de recadrage rond.",
      items: {
        dark: {
          name: "Sombre",
        },
        light: {
          name: "Clair",
        },
      },
    },
    colors: {
      title: "Couleurs",
      body: "Le logo et le logotype utilisent une même encre déclinée en trois niveaux d’opacité, avec une encre plus claire sur les fonds sombres. Les valeurs ci-dessous correspondent aux fichiers standard. Réservez-les au logo et au logotype, pas aux autres textes ni aux fonds. Cliquez sur une valeur pour la copier.",
      palettes: {
        light: {
          name: "Clair",
          swatches: {
            ink: {
              name: "Encre",
              use: "Le contour du logo et les lettres de « code ».",
            },
            "ink-70": {
              name: "Encre 70 %",
              use: "Les lettres de « open ».",
              ink: "L’encre à 70 % d’opacité.",
            },
            "ink-20": {
              name: "Encre 20 %",
              use: "L’ombre intérieure du logo.",
              ink: "L’encre à 20 % d’opacité.",
            },
          },
        },
        dark: {
          name: "Sombre",
          swatches: {
            ink: {
              name: "Encre",
              use: "Le contour du logo et les lettres de « code ».",
            },
            "ink-72": {
              name: "Encre 72 %",
              use: "Les lettres de « open ».",
              ink: "L’encre à 72 % d’opacité.",
            },
            "ink-28": {
              name: "Encre 28 %",
              use: "L’ombre intérieure du logo.",
              ink: "L’encre à 28 % d’opacité.",
            },
          },
        },
      },
    },
    variants: {
      title: "Variantes",
      body: "Pour garder le logo lisible, choisissez la version sombre sur fond clair et la version claire sur fond sombre. Le logo et le logotype sont fournis séparément. Utilisez l’un ou l’autre.",
      groups: {
        default: {
          name: "Par défaut",
          body: "Cette version convient à presque tous les usages. La teinte intérieure est transparente. Sur fond blanc ou noir, le résultat est identique à la version en deux gris. Sur une photo, un dégradé ou un fond coloré, le fond se voit par transparence.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Sombre",
                },
                light: {
                  name: "Clair",
                },
              },
            },
            wordmark: {
              title: "Logotype",
              tiles: {
                dark: {
                  name: "Sombre",
                },
                light: {
                  name: "Clair",
                },
              },
            },
          },
        },
        simple: {
          name: "Simple",
          body: "Une seule couleur, avec des contreformes ouvertes et sans teinte intérieure. Utilisez cette variante sur les aplats de couleur, en impression monochrome ou lorsque les gris ne conviennent pas. Choisissez la variante simple sombre sur fond clair, et la claire sur fond sombre.",
          rows: {
            wordmark: {
              title: "Logotype",
              tiles: {
                dark: {
                  name: "Sombre",
                },
                light: {
                  name: "Clair",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Règles d’utilisation",
      body: "Utilisez les versions claires sur fond clair et les versions sombres sur fond sombre. Le logo et le logotype sont distincts. Utilisez l’un ou l’autre, jamais les deux ensemble.",
      stroke: {
        title: "Un trait",
        body: "Les espacements se mesurent en traits. Un trait correspond à l’épaisseur du contour du logo, soit un quart de sa largeur. Le logo mesure donc 4 traits de large sur 5 traits de haut.",
      },
      clearSpace: {
        title: "Espace libre",
        body: "Laissez au moins deux traits d’espace libre tout autour du logo et du logotype. Pour le logo, un trait correspond à l’épaisseur du contour, soit le quart de sa largeur. Pour le logotype, c’est l’épaisseur des lettres, soit le septième de sa hauteur.",
      },
      pixels: {
        title: "Pixels entiers",
        body: "Le logo respecte un rapport de 4:5. Un trait représente le quart de sa largeur. Redimensionnez le logo par paliers de 4 × 5 px pour aligner chaque bord et chaque trait sur des pixels entiers.",
        do: "aligner chaque bord et le trait de 4 px sur des pixels entiers.",
        dont: "modifier le rapport 4:5. Les bords tomberaient entre deux pixels et deviendraient flous.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotype",
          },
        },
      },
      minimumTitle: "Tailles minimales",
      minimum: {
        logo: {
          title: "Logo",
          body: "Au moins 16 × 20 px, avec un trait de 4 px. En dessous, il devient flou.",
        },
        wordmark: {
          title: "Logotype",
          body: "Au moins 117 × 21 px, avec un trait de 3 px. En dessous, il devient flou.",
        },
      },
    },
    donts: {
      title: "À éviter",
      body: "Les erreurs courantes à éviter quand vous utilisez le logo et le logotype.",
      examples: {
        "two-tone": {
          caption: "recolorer le logo avec de nouvelles couleurs.",
        },
        bright: {
          caption: "utiliser une seule couleur vive.",
        },
        gradient: {
          caption: "remplir le logo avec un dégradé.",
        },
        inverted: {
          caption: "inverser les tons.",
        },
        stretch: {
          caption: "étirer ou écraser le logo.",
        },
        shadow: {
          caption: "ajouter des ombres portées.",
        },
        glow: {
          caption: "ajouter des halos ou des contours.",
        },
        lockup: {
          caption: "placer d’autres mots à côté du logo.",
        },
        "low-contrast": {
          caption: "utiliser du gris sur gris peu contrasté.",
        },
        color: {
          caption: "placer le logo bicolore gris sur un fond coloré, où ses gris deviennent ternes.",
        },
      },
    },
    integrations: {
      title: "Intégrations",
      body: "Les plugins, fournisseurs et outils compatibles avec OpenCode, ainsi que les projets réalisés avec lui, peuvent l’indiquer. Utilisez un badge ou associez les logos. Choisissez un nom de projet qui montre clairement qu’il s’agit du vôtre.",
      badges: {
        body: "Placez un badge dans votre README, votre doc ou votre site et faites-le pointer vers opencode.ai. Choisissez le fichier clair ou sombre selon votre fond (le HTML bascule tout seul), et ne modifiez ni les couleurs ni le texte.",
        sizes: "Les styles existent en 20, 32 et 44 px (Shields en 20 px seulement), au format SVG ou PNG en 2×.",
        mono: "Chaque fichier existe aussi avec du texte en OpenMono. Ajoutez -mono avant l’extension, par exemple dans opencode-works-with-a-light-20-mono.svg, ou -mono-caps pour afficher OpenMono en majuscules.",
        groups: {
          "works-with": {
            title: "Compatible avec",
            alt: "Compatible avec OpenCode",
            body: "Pour les plugins, fournisseurs et outils qui fonctionnent avec OpenCode.",
          },
          "built-with": {
            title: "Créé avec",
            alt: "Créé avec OpenCode",
            body: "Pour les projets réalisés avec OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Cadre",
          },
          c: {
            name: "Cellules",
          },
          f: {
            name: "Plein",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Association de logos",
        body: "Placez les logos d’OpenCode et du partenaire côte à côte, séparés par un ×. Laissez 3 traits d’espace de chaque côté du ×. Ajustez le logo du partenaire pour qu’il paraisse aussi haut que celui d’OpenCode et laissez de l’espace autour de l’ensemble.",
      },
      naming: {
        title: "Nommer votre projet",
        body: "Placez le nom de votre projet en premier pour qu’il soit clair que le projet est le vôtre.",
        rule: "Écrivez `Linear for OpenCode` ou nommez le paquet `opencode-linear`. N’écrivez pas `OpenCode Linear` ni `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marques",
      body: "OpenCode et le logo OpenCode sont des marques d’Anomaly. Ne les utilisez pas pour laisser entendre qu’Anomaly vous soutient ou vous sponsorise, ni dans le nom de votre produit ou de votre entreprise, ni sur des produits dérivés sans autorisation.",
      contact: {
        before: "Pour toute question, écrivez à ",
      },
    },
  },
  press: {
    title: "OpenCode | Kit presse, chiffres clés et ressources de marque",
    description:
      "Le kit presse d’OpenCode, avec des informations sur OpenCode et sur Anomaly, l’entreprise qui le développe, des logos et logotypes à télécharger et un contact presse.",
    hero: {
      title: "Presse",
      body: "Chiffres clés, ressources de marque et contacts pour vos articles sur OpenCode et Anomaly.",
    },
    company: {
      title: "À propos d’Anomaly",
      lead: "Anomaly développe OpenCode et d’autres outils open source pour les développeurs.",
      more: "Parmi ses autres projets figurent SST et OpenTUI, tous open source sur [GitHub](github).",
      projects: {
        opencode: {
          body: "L’agent de code open source. Applications Desktop, terminal et mobile, et SDK. Sous licence MIT, avec plus de 220 000 étoiles sur GitHub.",
        },
        sst: {
          body: "Un framework pour créer des applications full-stack sur votre propre infrastructure. Open source depuis 2020, sous licence MIT, avec plus de 26 000 étoiles sur GitHub.",
        },
        opentui: {
          body: "Une bibliothèque d’interfaces terminal en TypeScript, React ou Solid, avec un cœur en Zig. OpenCode l’utilise en production. Plus de 13 000 étoiles sur GitHub.",
          name: "OpenTUI",
        },
        "models-dev": {
          body: "Une base de données open source qui recense les caractéristiques, tarifs et capacités des modèles AI, avec une API publique. Elle couvre plus de 8 900 modèles de plus de 200 fournisseurs.",
        },
        hex: {
          body: "Dictée vocale pour Mac, Windows et Linux. Hex transcrit et colle le texte dans n’importe quelle application. L’audio ne quitte jamais votre appareil.",
        },
        opentunnel: {
          body: "Une CLI et un SDK qui donnent une URL HTTPS publique aux applications sur votre machine. La connexion TLS se termine sur votre machine. Le relais n’accède jamais aux données en clair.",
        },
      },
      learnMore: "Pour en savoir plus, rendez-vous sur [anoma.ly](site).",
    },
    about: {
      title: "À propos d’OpenCode",
      body: "Des descriptions d’OpenCode et de ses produits, en version longue et courte, prêtes à copier.",
      boilerplate: {
        long: "OpenCode est un agent de code open source disponible dans Desktop, dans le terminal, sur mobile et via un SDK. Il fonctionne avec les modèles de tous les fournisseurs, dont Claude, GPT et Gemini. Développé par Anomaly sous licence MIT, OpenCode compte plus de 220 000 étoiles sur GitHub et plus de 1 000 contributeurs. Plus de 22 millions de développeurs l’utilisent chaque mois.",
        short:
          "OpenCode est un agent de code open source d’Anomaly, disponible sur Desktop, dans le terminal, sur mobile et via un SDK.",
      },
      products: {
        "opencode-console": {
          long: "OpenCode Console est l’application web où les développeurs et les équipes peuvent acheter et gérer l’accès aux modèles AI pour OpenCode et d’autres agents de code. Elle propose des abonnements OpenCode Go et de l’inférence à l’utilisation pour les modèles de pointe et à poids ouverts. Chaque requête est facturée sur les crédits prépayés. Les équipes disposent d’espaces de travail avec les rôles Member, Admin et Owner, des plafonds de dépenses par espace et par utilisateur, de l’authentification unique avec Okta, Microsoft Entra ID ou Google Workspace, et de SCIM. Console prend en charge plus de 30 fournisseurs. Les équipes peuvent donc connecter leurs comptes existants. L’inférence OpenCode reste facultative. Disponible sur opencode.ai/console.",
          short:
            "OpenCode Console est l’application web d’Anomaly pour accéder aux modèles AI à l’utilisation, s’abonner à OpenCode Go et gérer son équipe avec des budgets et l’authentification unique.",
          name: "OpenCode Console",
        },
        "opencode-go": {
          long: "OpenCode Go donne aux développeurs accès à des modèles de code pour un prix mensuel fixe. Go coûte 10 $ par mois, Go Plus 40 $ par mois avec des quotas plus élevés, et Go Teams 20 $ par mois et par membre. Chaque formule inclut une sélection de modèles testés avec des agents de code. Le quota mensuel, exprimé en dollars, varie selon le modèle. Les plafonds glissants sont de 20 % du quota mensuel par tranche de 5 heures et de 50 % par semaine. Les abonnés peuvent ajouter des crédits, payer le dépassement à l’utilisation sur leur solde et résilier à tout moment. Go fonctionne avec OpenCode et d’autres agents. Disponible sur opencode.ai/console/go.",
          short:
            "OpenCode Go est l’abonnement mensuel d’Anomaly qui donne aux développeurs accès à une sélection de modèles de code avec des quotas mensuels, dès 10 $ par mois.",
        },
        "opencode-data": {
          long: "OpenCode Data est un tableau de bord public qui montre quels modèles AI les développeurs utilisent dans OpenCode et comment cette répartition évolue. Il publie le classement des modèles les plus utilisés, l’utilisation des tokens, les coûts par session et par token, les ratios de cache, les parts de marché et une répartition par pays. Les chiffres sont agrégés toutes les heures. Les jours et les semaines sont calculés en UTC. Les nombres d’utilisateurs et de sessions sont approximatifs, et les coûts reposent sur les prix catalogue des modèles OpenCode. Les journalistes peuvent citer OpenCode Data (opencode.ai/data) en indiquant l’heure de mise à jour affichée sur la page.",
          short:
            "OpenCode Data est un tableau de bord public sur opencode.ai/data. Il classe les modèles AI selon leur utilisation réelle dans OpenCode et actualise chaque heure les données sur les tokens, les coûts et les parts de marché.",
          name: "OpenCode Data",
        },
      },
    },
    facts: {
      title: "En bref",
      items: {
        license: {
          label: "Licence",
        },
        "first-release": {
          label: "Première version",
        },
        "made-by": {
          label: "Créé par",
        },
      },
    },
    milestones: {
      title: "Étapes clés",
      items: {
        "first-release-v0-0-1": {
          date: "Avr. 2025",
          text: "Première version, v0.0.1",
        },
        "1-million-downloads": {
          date: "Oct. 2025",
          text: "Plus d’un million de téléchargements",
        },
        "opencode-1-0": {
          date: "Oct. 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Déc. 2025",
          text: "Sortie de l’application Desktop",
        },
        "10-million-downloads": {
          date: "Janv. 2026",
          text: "Plus de 10 millions de téléchargements",
        },
        "opencode-2-0": {
          date: "Sept. 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Nov. 2026",
          text: "Plus de 220 000 étoiles sur GitHub",
        },
      },
    },
    news: {
      title: "Dernières versions",
      intro: "Nous publions souvent de nouvelles versions d’OpenCode. Voici les dernières à introduire des fonctionnalités.",
      changelog: {
        text: "Changelog complet",
      },
      feed: {
        text: "Flux RSS",
      },
    },
    media: {
      title: "Médias",
      intro:
        "Images et courtes vidéos de chaque application, directement capturées dans le produit. Vous pouvez les utiliser dans vos articles sur OpenCode.",
      note: "Toutes les captures utilisent le thème sombre. Les images fixes et de couverture sont en JPG, jusqu’à 1920 × 1080 ou 1080 × 1350 en portrait. Les vidéos sont des clips MP4 sans son.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Film Desktop",
            },
            "frame-1": {
              title: "Image Desktop 1",
            },
            "frame-2": {
              title: "Image Desktop 2",
            },
            "frame-3": {
              title: "Image Desktop 3",
            },
            "frame-4": {
              title: "Image Desktop 4",
            },
            "feature-1": {
              title: "Agents en parallèle",
            },
            "feature-2": {
              title: "À voir dans le navigateur",
            },
            "feature-3": {
              title: "Sur tous vos appareils",
            },
            "locked-portrait": {
              title: "Film Desktop, portrait",
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
              title: "Image Mobile 1",
            },
            "frame-2": {
              title: "Image Mobile 2",
            },
            "frame-3": {
              title: "Image Mobile 3",
            },
            "feature-1": {
              title: "Voix",
            },
            "feature-2": {
              title: "Sessions",
            },
            "feature-3": {
              title: "Résultats",
            },
            "locked-portrait": {
              title: "Film Mobile, portrait",
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
              title: "Image Terminal 1",
            },
            "frame-2": {
              title: "Image Terminal 2",
            },
            "frame-3": {
              title: "Image Terminal 3",
            },
            "frame-4": {
              title: "Image Terminal 4",
            },
            "feature-1": {
              title: "Formulez votre demande",
            },
            "feature-2": {
              title: "Validez les commandes",
            },
            "feature-3": {
              title: "À votre image",
            },
            "locked-portrait": {
              title: "Film Terminal, portrait",
            },
          },
        },
        sdk: {
          items: {
            "locked-landscape": {
              title: "Film SDK",
            },
            "frame-1": {
              title: "Image SDK 1",
            },
            "frame-2": {
              title: "Image SDK 2",
            },
            "frame-3": {
              title: "Image SDK 3",
            },
            "frame-4": {
              title: "Image SDK 4",
            },
            "feature-1": {
              title: "Corriger la CI par le code",
            },
            "feature-2": {
              title: "Suivre chaque étape",
            },
            "feature-3": {
              title: "Créez vos outils",
            },
            "locked-portrait": {
              title: "Film SDK, portrait",
            },
          },
        },
      },
    },
    people: {
      title: "Équipe",
    },
    anomalyLogo: {
      title: "Logo Anomaly",
      body: "Le symbole et le logotype Anomaly, en noir et en blanc. Les PNG font 2048 px de large.",
      assets: {
        "mark-black": {
          name: "Symbole, noir",
        },
        "mark-white": {
          name: "Symbole, blanc",
        },
        "wordmark-black": {
          name: "Logotype, noir",
        },
        "wordmark-white": {
          name: "Logotype, blanc",
        },
      },
      avatars: {
        body: "Des avatars carrés pour X, GitHub, Slack, LinkedIn et d'autres profils. Le symbole reste bien à l'intérieur du cercle, pour résister à un recadrage rond. Les PNG font 1024 et 400 px de large.",
        items: {
          "avatar-dark": { name: "Avatar, sombre" },
          "avatar-light": { name: "Avatar, clair" },
        },
      },
      all: {
        text: "Tout télécharger",
      },
    },
    coverage: {
      title: "Articles",
    },
    brand: {
      title: "Marque",
      before:
        "Téléchargez les logos et logotypes OpenCode dans un fichier ZIP. Pour les fichiers individuels, les variantes et les règles d’utilisation, consultez la ",
      link: {
        text: "page Marque",
      },
      usage:
        "Vous pouvez utiliser ces fichiers dans vos articles sur OpenCode. Ne les modifiez pas et ne laissez pas entendre qu’OpenCode cautionne votre travail.",
    },
    product: {
      title: "Produit",
      items: {
        desktop: {
          name: "Desktop",
          body: "Lancez plusieurs agents à la fois, chacun dans son onglet, sur macOS, Windows et Linux. Examinez les diffs et prévisualisez le résultat.",
        },
        mobile: {
          name: "Mobile",
          body: "La dernière application OpenCode. Appelez une session pour parler à l’agent, puis vérifiez et approuvez ses modifications depuis votre téléphone, où que vous soyez.",
        },
        terminal: {
          name: "Terminal",
          body: "Une interface terminal compatible avec tous les shells, éditeurs et serveurs distants. Suivez chaque diff et choisissez les commandes qui peuvent s’exécuter automatiquement.",
        },
        sdk: {
          body: "Un client TypeScript typé pour vos scripts, vos tâches CI et vos outils. Créez des sessions, envoyez des prompts et recevez chaque événement en temps réel.",
        },
      },
    },
    contact: {
      title: "Contact",
      items: {
        press: {
          title: "Presse",
          body: "Pour les journalistes et analystes. Nous ne répondons qu’aux demandes des médias.",
        },
        support: {
          title: "Support",
          body: "Pour obtenir de l’aide sur OpenCode, ouvrez une issue ou demandez à la communauté. Pour les questions de compte et de facturation, écrivez-nous.",
          links: {
            "github-issues": {
              text: "Issues GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Sécurité",
          body: "Signalez toute vulnérabilité sur GitHub. Sans réponse sous 6 jours ouvrés, écrivez-nous.",
          links: {
            "report-a-vulnerability": {
              text: "Signaler une vulnérabilité",
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
      title: "Extensions",
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
        label: "Lire la doc du SDK",
      },
    },
    mini: {
      lead: "Mini est inclus dans OpenCode CLI. Installez-le avec l’une de ces commandes, puis lancez opencode mini.",
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
    title: "Connectez votre téléphone",
    cardTitle: "Associez votre téléphone en une commande",
    intro:
      "OpenCode Mobile vous permet de piloter OpenCode à distance. Vos sessions continuent sur votre ordinateur. Suivez-les et pilotez-les depuis l’application.",
    steps: {
      "get-the-app": {
        title: "Installez l’application",
        body: "Installez la bêta d’OpenCode sur iPhone via TestFlight ou l’application sur votre téléphone Android.",
      },
      "run-this-on-your-computer": {
        title: "Lancez la commande sur votre ordinateur",
        body: "La commande affiche un lien et un QR code à usage unique. Ils expirent au bout de 5 minutes.",
      },
      "scan-the-code": {
        title: "Scannez le code",
        body: "Scannez le QR code dans l’application ou collez le lien. Les sessions récentes de votre ordinateur s’ouvrent sur votre téléphone.",
      },
    },
    note: "L’option --remote passe par une adresse OpenTunnel. Elle fonctionne depuis n’importe quel réseau. Sur le même Wi-Fi, lancez opencode service set hostname 0.0.0.0 une seule fois, puis opencode pair.",
    facts: [
      "L’association fonctionne depuis n’importe quel réseau, car --remote se connecte via une adresse OpenTunnel.",
      "Le lien et le code ne servent qu’une fois et expirent au bout de 5 minutes.",
      "Laissez l’ordinateur allumé. L’agent s’exécute sur l’ordinateur, pas sur le téléphone.",
      "Sur le même Wi-Fi, lancez une fois opencode service set hostname 0.0.0.0, puis opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Créez, installez et partagez des plugins pour Desktop.",
      link: "Nouveautés de la 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Les terminaux de Desktop restent ouverts après un redémarrage.",
      link: "Voir la v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Les agents peuvent maintenant générer des images.",
      link: "Voir la v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Pilotez vos sessions depuis votre téléphone.",
      link: "Découvrir OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "Une application Desktop repensée.",
      link: "Nouveautés de la 2.2",
    },
  },
} satisfies ContentOverlay
