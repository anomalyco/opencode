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
      body: "Une interface terminal rapide qui fonctionne dans tout shell, éditeur ou serveur distant.",
      action: "Installer",
    },
    sdk: {
      body: "Pilotez OpenCode depuis vos scripts, jobs CI et outils.",
      action: "Lire la doc",
    },
    mini: {
      body: "Une interface terminal minimale. Les réponses s'affichent dans votre historique, avec un seul prompt en dessous.",
      action: "Installer",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | App desktop pour macOS, Windows et Linux",
      description:
        "Lancez autant d'agents OpenCode que vous voulez en parallèle, voyez chaque changement dans un navigateur à côté et reprenez-les sur tout appareil. Pour macOS, Windows et Linux.",
      intro:
        "Lancez plusieurs agents à la fois, chaque session dans son propre onglet. Relisez chaque changement en diff, commentez n'importe quelle ligne et vérifiez le résultat dans le navigateur intégré. Pour macOS, Windows et Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agents en parallèle",
          body: "Lancez autant d'agents que vous voulez et laissez-les tous travailler en parallèle. Passez de l'un à l'autre à mesure qu'ils terminent.",
        },
        "see-it-in-the-browser": {
          title: "Voir dans le navigateur",
          body: "Votre app s'ouvre dans un navigateur à côté de l'agent, pour que vous voyiez tous les deux chaque changement arriver.",
        },
        "on-every-device": {
          title: "Sur tous vos appareils",
          body: "Lancez des agents sur tous vos appareils et reprenez-les depuis l'app desktop, le terminal ou votre téléphone.",
        },
        "extend-it": {
          title: "Étendez-le",
          body: "Connectez vos outils et services pour que l'agent puisse travailler avec tout. Ou demandez à OpenCode de créer ses propres plugins, avec leur interface dans la barre latérale.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, vos sessions de code sur votre téléphone",
      description:
        "Lancez et pilotez des sessions OpenCode depuis votre téléphone. Parlez à l'agent pendant qu'il tourne sur votre ordinateur.",
      intro:
        "Lancez et pilotez des sessions depuis votre téléphone, où que vous soyez. Appelez une session et parlez à l'agent, ou ouvrez une session pour reprendre où vous en étiez, le tout avec OpenCode sur votre propre ordinateur.",
      features: {
        "notify-when-done": {
          title: "Notifié à la fin",
          body: "Recevez un court résumé quand une session que vous avez lancée se termine.",
        },
        "pair-from-anywhere": {
          title: "Associez de partout",
          body: "Connectez-vous depuis n'importe quel réseau avec opencode pair --remote.",
        },
        "every-computer": {
          title: "Tous vos postes",
          body: "Passez d'un ordinateur associé à l'autre d'un seul geste.",
        },
        "siri-and-shortcuts": {
          title: "Siri et Raccourcis",
          body: "Lancez un appel ou une session depuis Siri ou le Centre de contrôle.",
        },
        "follow-along": {
          title: "Suivez en direct",
          body: "Regardez la timeline se mettre à jour pendant que l'agent travaille.",
        },
        "your-computer": {
          title: "Votre ordinateur",
          body: "Se connecte à OpenCode sur votre propre machine.",
        },
        "share-sheet": {
          title: "Menu Partager",
          body: "Partagez n'importe quoi vers une session sans ouvrir l'app.",
        },
        "mute-sessions": {
          title: "Mettre en sourdine",
          body: "Gardez une session dans votre liste sans recevoir ses notifications.",
        },
      },
      showcase: {
        voice: {
          title: "Voix",
          body: "Appelez une session et parlez. L'agent vous répond à voix haute.",
        },
        sessions: {
          title: "Sessions",
          body: "Ouvrez une session pour voir où elle en est, puis reprenez-la.",
        },
        steer: {
          title: "Piloter",
          body: "Envoyez un message de suivi pour changer de direction en cours de session.",
        },
        results: {
          title: "Résultats",
          body: "L'appel vous dit ce qui a changé une fois le travail demandé terminé.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interface terminal de l'agent de code open source",
      description:
        "Une interface terminal rapide pour OpenCode, qui fonctionne dans tout shell, éditeur ou serveur distant. Décrivez ce que vous voulez, voyez chaque modification en diff et approuvez les commandes.",
      intro:
        "Une interface terminal rapide qui fonctionne dans tout shell, éditeur ou serveur distant. Décrivez ce que vous voulez avec vos mots, regardez chaque modification arriver en diff et choisissez quelles commandes s'exécutent seules.",
      features: {
        "any-terminal": {
          title: "Tout terminal",
          body: "Fonctionne dans tout shell, dans le terminal de votre éditeur ou sur un serveur distant.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs dans la timeline",
          body: "Voyez chaque modification en diff dans la timeline, au moment où l'agent la fait.",
        },
        "pick-up-later": {
          title: "Reprendre après",
          body: "Reprenez la dernière session avec -c, ou n'importe laquelle avec -s.",
        },
        "one-off-runs": {
          title: "Exécution unique",
          body: "opencode run envoie un message et affiche la réponse.",
        },
        "agents-and-commands": {
          title: "Agents et commandes",
          body: "Changez d'agent avec shift+tab et ouvrez toutes les commandes avec ctrl+p.",
        },
        "auto-approve": {
          title: "Approbation auto",
          body: "Lancez avec --auto pour autoriser toute action que vous n'avez pas refusée.",
        },
        "any-server": {
          title: "Tout serveur",
          body: "Connectez-vous à un serveur OpenCode par URL avec --server.",
        },
        "usage-stats": {
          title: "Statistiques",
          body: "opencode stats affiche des statistiques d'usage à partager.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Demandez avec vos mots",
          body: "Tapez ce que vous voulez, l'agent montre son plan en travaillant.",
        },
        "approve-what-runs": {
          title: "Validez les commandes",
          body: "Les modifications s'affichent en diff, et les commandes attendent votre permission.",
        },
        "make-it-yours": {
          title: "À votre image",
          body: "Changez de thème en une touche, du thème par défaut à tokyonight et bien d'autres.",
        },
        mini: {
          title: "Mini",
          body: "Avec opencode mini, les réponses vont dans votre historique.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript pour scripts, jobs CI et outils",
      description:
        "Pilotez OpenCode depuis vos scripts, jobs CI et outils. Le client TypeScript typé crée des sessions, envoie des prompts et diffuse chaque événement en temps réel.",
      intro:
        "Pilotez OpenCode depuis vos scripts, jobs CI et outils. Le SDK exécute OpenCode dans votre processus, avec votre configuration et vos modèles, et son client typé crée des sessions, envoie des prompts et diffuse chaque événement.",
      features: {
        "typescript-client": {
          title: "Client TypeScript",
          body: "Requêtes et événements typés, avec les mêmes valeurs que @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessions par le code",
          body: "Créez des sessions et envoyez des prompts depuis n'importe quel script.",
        },
        "any-model": {
          title: "Tout modèle",
          body: "Utilise les modèles configurés dans votre OpenCode.",
        },
        "npm-or-bun": {
          title: "npm ou bun",
          body: "Installez-le avec npm i @opencode/sdk ou bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Hôte in-process",
          body: "Exécute OpenCode en mémoire, sans passer par le réseau.",
        },
        "your-plugins": {
          title: "Vos plugins",
          body: "Passez vos propres plugins à la création de l'hôte in-process.",
        },
        "promise-or-effect": {
          title: "Promise ou Effect",
          body: "Une API Promise et une API Effect, avec les mêmes valeurs.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Exécutez OpenCode dans un Durable Object Cloudflare sur Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Réparer la CI en code",
          body: "Un court script demande à OpenCode de corriger les tests en échec, puis les relance.",
        },
        "follow-every-step": {
          title: "Suivre chaque étape",
          body: "Diffusez les événements pour voir chaque outil appelé par l'agent, en temps réel.",
        },
        "build-your-own-tools": {
          title: "Créez vos outils",
          body: "Intégrez OpenCode à des bots, tableaux de bord et workflows en quelques lignes.",
        },
        "in-your-process": {
          title: "Dans votre processus",
          body: "Exécute OpenCode dans votre processus, avec votre config et vos modèles.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, une interface terminal minimale pour l'agent",
      description:
        "Mini exécute OpenCode dans une interface terminal minimale. Les réponses s'affichent dans l'historique de votre terminal, et seuls un prompt et une ligne d'état restent en bas.",
      intro:
        "Une interface terminal minimale pour OpenCode. Lancez opencode mini et les réponses s'affichent directement dans l'historique de votre terminal, pour les faire défiler, les rechercher et les copier comme toute autre sortie. Seuls le prompt et une ligne d'état restent en bas.",
      features: {
        "your-scrollback": {
          title: "Votre historique",
          body: "Les réponses deviennent de l'historique de terminal ordinaire.",
        },
        "one-prompt": {
          title: "Un seul prompt",
          body: "Agent, modèle, contexte et coût sur une ligne d'état.",
        },
        permissions: {
          title: "Permissions",
          body: "Autorisez modifications et commandes depuis la zone de prompt.",
        },
        "how-much-shows": {
          title: "Niveau de détail",
          body: "Discret, par défaut ou tout, pour la réflexion et la sortie des outils.",
        },
        "pick-up-later": {
          title: "Reprendre après",
          body: "Reprenez la dernière session avec -c, ou n'importe laquelle avec -s.",
        },
        "same-opencode": {
          title: "Le même OpenCode",
          body: "Le même serveur, les mêmes agents et modèles que les autres apps.",
        },
        agents: {
          title: "Agents",
          body: "Changez d'agent directement depuis le prompt.",
        },
        compact: {
          title: "Compacter",
          body: "Réduisez une longue session avec /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensions",
    body: "Utilisez OpenCode dans VS Code, ou dans Zed et d'autres éditeurs via ACP.",
    action: "Installer",
  },
  extensions: {
    browse: {
      body: "Laissez les agents utiliser votre vrai navigateur.",
      title: "OpenCode | Browse, votre vrai navigateur pour agents de code",
      description:
        "Browse permet à OpenCode et à d'autres clients MCP d'utiliser votre vrai navigateur. Les agents pilotent des onglets en arrière-plan avec Playwright et vous rendent la main pour les connexions et la 2FA.",
      intro:
        "Un serveur MCP et une extension Chromium qui permettent à vos agents d'utiliser votre vrai navigateur, avec vos onglets, vos connexions et vos extensions. Ils ouvrent et pilotent des onglets avec Playwright, font des captures d'écran et enregistrent l'écran, dans des onglets en arrière-plan regroupés à l'écart. Quand c'est votre tour, pour une connexion, une demande de 2FA ou un paiement, ils vous rendent l'onglet et reprennent dès que vous cliquez sur Continuer.",
      features: {
        "your-real-browser": {
          title: "Votre vrai navigateur",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera et Chromium.",
        },
        "out-of-your-way": {
          title: "Hors de votre chemin",
          body: "Les onglets des agents s'ouvrent en arrière-plan, dans des groupes repliés.",
        },
        handoffs: {
          title: "Relais",
          body: "Faites vous-même la connexion ou l'étape 2FA, puis cliquez sur Continuer.",
        },
        "lend-a-tab": {
          title: "Prêt d'onglet",
          body: "Cliquez sur le bouton de la barre d'outils pour confier à un agent un onglet ouvert.",
        },
        "record-and-capture": {
          title: "Enregistrer et capturer",
          body: "Captures d'écran, enregistrements d'écran et trafic réseau au format HAR.",
        },
        "any-mcp-client": {
          title: "Tout client MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed et bien d'autres.",
        },
        "all-your-logins": {
          title: "Toutes vos connexions",
          body: "Les agents utilisent les sites où vous êtes déjà connecté. Pas de clés, pas de configuration.",
        },
        allowlists: {
          title: "Liste blanche",
          body: "Limitez les onglets d'une session aux sites que vous indiquez.",
        },
      },
      install:
        "Installez d'abord l'[extension Chrome]. Elle vous guide pour le reste des étapes. Pour installer la CLI directement (vous ne devriez pas en avoir besoin), utilisez l'une de ces commandes.",
    },
  },
  apps: {
    browse: {
      category: "Contrôle du navigateur pour agents",
      body: "Laissez votre agent utiliser votre vrai navigateur, avec vos connexions et vos onglets.",
    },
    opentunnel: {
      category: "Tunnels locaux",
      body: "Des URL HTTPS publiques pour vos apps locales.",
    },
    opentui: {
      category: "Bibliothèque",
      body: "Une bibliothèque d'interfaces utilisateur pour le terminal.",
    },
    hex: {
      category: "Dictée vocale",
      body: "Dictée vocale sur l'appareil, pour toute app.",
    },
  },
  getStarted: {
    title: "Démarrer",
    lead: "Le plus simple pour commencer est de télécharger OpenCode et d'utiliser les modèles gratuits. Aucun compte requis. Pour aller plus loin, utilisez votre propre abonnement ou OpenCode Go.",
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
        title: "Modèles gratuits",
        line: "OpenCode inclut des modèles gratuits. Aucun compte requis.",
      },
      "add-more-models": {
        title: "Plus de modèles",
        line: "Utilisez votre propre abonnement, ou les modèles sélectionnés d'OpenCode Go dès 10 $/mois.",
      },
    },
    sentence:
      "Téléchargez OpenCode, commencez avec les modèles gratuits, puis ajoutez votre propre abonnement ou OpenCode Go quand vous voulez plus.",
  },
  byos: {
    title: "Apportez votre abonnement",
    headline: "Utilisez les abonnements que vous avez déjà.",
    line: "Connectez-vous avec ChatGPT Plus ou Pro, ou avec GitHub Copilot. Ou prenez un abonnement OpenCode.",
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
        text: "Règles pour agent",
        copied: "Règles copiées",
      },
    },
    naming: {
      title: "Nom",
      body: "Écrivez OpenCode en un seul mot, avec un O et un C majuscules. N'écrivez pas Opencode, Open Code, OpenCode AI ou Open-Code.",
      code: "Utilisez `opencode` en minuscules uniquement dans le code et les noms de paquets, comme `opencode-figma` ou `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "Le logo seul, pour les icônes d'app, les avatars et les petits espaces. Les versions carrées ajoutent une marge pour les endroits qui recadrent en carré.",
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
        body: "Le nom complet dans les lettres OpenCode. Utilisez-le partout où il y a la place d'écrire le nom en entier.",
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
        body: "Une version monochrome du logotype, pour l'impression, la broderie et les endroits qui n'acceptent qu'une couleur.",
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
      body: "Des avatars carrés de 1024px pour Slack, Discord, GitHub et d'autres profils. Le fond remplit tout le carré et le logo reste bien à l'intérieur du cercle, pour résister à un recadrage rond.",
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
      body: "Le logo et le logotype utilisent une seule encre à trois opacités, avec une encre plus claire pour les fonds sombres. Les valeurs ci-dessous sont cette encre sur du blanc ou du #0B0B0B, comme dans les fichiers standards. Cliquez sur une valeur pour la copier.",
      palettes: {
        light: {
          name: "Clair",
          swatches: {
            ink: {
              name: "Encre",
              use: "Le contour du logo et les lettres de « code ».",
            },
            "ink-70": {
              name: "Encre 70%",
              use: "Les lettres de « open ».",
              ink: "L'encre à 70% d'opacité.",
            },
            "ink-20": {
              name: "Encre 20%",
              use: "L'ombre intérieure du logo.",
              ink: "L'encre à 20% d'opacité.",
            },
          },
        },
        dark: {
          name: "Sombre",
          swatches: {
            ink: {
              name: "Encre",
              use: "Le contour du logo et les lettres de « code ».",
            },
            "ink-72": {
              name: "Encre 72%",
              use: "Les lettres de « open ».",
              ink: "L'encre à 72% d'opacité.",
            },
            "ink-28": {
              name: "Encre 28%",
              use: "L'ombre intérieure du logo.",
              ink: "L'encre à 28% d'opacité.",
            },
          },
        },
      },
    },
    variants: {
      title: "Variantes",
      body: "Choisissez la version qui garde le logo lisible sur votre fond, sombre sur fond clair et claire sur fond sombre. Le logo et le logotype sont des fichiers distincts, donc utilisez l'un ou l'autre.",
      groups: {
        default: {
          name: "Par défaut",
          body: "Le logo à utiliser presque partout. Son ombre intérieure est transparente. Sur du blanc ou du noir, il ressemble exactement à la version bicolore grise, et sur les photos, les dégradés et les couleurs, le fond transparaît.",
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
          body: "Une seule couleur, avec des contreformes ouvertes et sans ombre intérieure. Utilisez-le sur des fonds de couleur unie, pour l'impression en une couleur et partout où les gris ne conviennent pas, en simple sombre sur les couleurs claires et en simple clair sur les couleurs sombres.",
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
      title: "Usage",
      body: "Utilisez les versions claires sur fond clair et les versions sombres sur fond sombre. Le logo et le logotype sont distincts, donc utilisez l'un ou l'autre, jamais les deux ensemble.",
      stroke: {
        title: "Un trait",
        body: "Les règles d'espacement de cette page se mesurent en traits. Un trait correspond à l'épaisseur du contour du logo, soit un quart de sa largeur, donc le logo fait 4 traits de large et 5 traits de haut.",
      },
      clearSpace: {
        title: "Espace libre",
        body: "Gardez au moins deux traits d'espace de chaque côté du logo et du logotype. Pour le logo, un trait correspond à l'épaisseur de son contour, soit un quart de sa largeur. Pour le logotype, c'est l'épaisseur de ses lettres, soit un septième de sa hauteur.",
      },
      pixels: {
        title: "Pixels entiers",
        body: "Les proportions du logo sont fixées à 4:5, et un trait fait un quart de sa largeur. Redimensionnez-le par paliers de 4 × 5px, pour que chaque bord et chaque trait tombent sur un pixel entier.",
        do: "garder chaque bord et le trait de 4px sur des pixels entiers.",
        dont: "dimensionner le logo hors du 4:5, sinon ses bords tombent entre les pixels et deviennent flous.",
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
          body: "Au moins 16 × 20px, avec un trait de 4px. En dessous, il devient flou.",
        },
        wordmark: {
          title: "Logotype",
          body: "Au moins 117 × 21px, avec un trait de 3px. En dessous, il devient flou.",
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
          caption: "placer d'autres mots à côté du logo.",
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
      body: "Les plugins, fournisseurs et outils qui fonctionnent avec OpenCode, et les projets créés avec lui, peuvent le dire. Utilisez un badge ou un lockup partenaire, et nommez votre projet de façon à montrer clairement qu'il vous appartient.",
      badges: {
        body: "Placez un badge dans votre README, votre doc ou votre site et faites-le pointer vers opencode.ai. Choisissez le fichier clair ou sombre selon votre fond (le HTML bascule tout seul), et ne modifiez ni les couleurs ni le texte.",
        sizes: "Chaque style existe en 20, 32 et 44px (Shields uniquement en 20px), en SVG et en PNG à 2×.",
        mono: "Chaque fichier existe aussi avec un texte en OpenTUI Mono. Ajoutez -mono avant l'extension, comme dans opencode-works-with-a-light-20-mono.svg, ou -mono-caps pour le même texte en majuscules.",
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
        title: "Lockup partenaire",
        body: "Placez le logo OpenCode et le logo partenaire côte à côte, avec un × entre les deux. Laissez 3 traits d'espace de chaque côté du ×, dimensionnez le logo partenaire pour qu'il paraisse aussi haut que le logo OpenCode, et gardez un espace libre autour de l'ensemble.",
      },
      naming: {
        title: "Nommer votre projet",
        body: "Commencez par votre propre nom, pour montrer clairement que le projet vous appartient.",
        rule: "Écrivez `Linear for OpenCode` ou nommez le paquet `opencode-linear`. N'écrivez pas `OpenCode Linear` ni `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marques",
      body: "OpenCode et le logo OpenCode sont des marques d'Anomaly. Ne les utilisez pas pour laisser entendre qu'Anomaly vous soutient ou vous sponsorise, ni dans le nom de votre produit ou de votre entreprise, ni sur des produits dérivés sans autorisation.",
      contact: {
        before: "Pour toute question, écrivez à ",
      },
    },
  },
  press: {
    title: "OpenCode | Kit presse, infos sur l'entreprise et ressources",
    description:
      "Le kit presse d'OpenCode, avec des informations sur OpenCode et sur Anomaly, l'entreprise qui le développe, des logos et logotypes à télécharger et un contact presse.",
    hero: {
      title: "Presse",
      body: "Informations, ressources de marque et contacts pour écrire sur OpenCode et Anomaly.",
    },
    company: {
      title: "À propos d'Anomaly",
      lead: "Anomaly est l'entreprise derrière OpenCode. Elle crée des outils open source pour les développeurs.",
      more: "Parmi ses autres projets figurent SST et OpenTUI, tous open source sur [GitHub](github).",
      projects: {
        opencode: {
          body: "L'agent de code open source, avec des apps desktop, terminal et mobile, et un SDK. Sous licence MIT, plus de 220 000 étoiles sur GitHub.",
        },
        sst: {
          body: "Un framework pour créer des apps full-stack sur votre propre infrastructure. Sous licence MIT, open source depuis 2020, plus de 26 000 étoiles sur GitHub.",
        },
        opentui: {
          body: "Une bibliothèque d'interfaces terminal en TypeScript, React ou Solid, avec un cœur en Zig. OpenCode l'utilise en production. Plus de 13 000 étoiles sur GitHub.",
          name: "OpenTUI",
        },
        "models-dev": {
          body: "Une base de données open source des caractéristiques, prix et capacités des modèles d'IA, avec une API publique. Elle recense plus de 8 900 modèles de plus de 200 fournisseurs.",
        },
        hex: {
          body: "Dictée vocale pour Mac, Windows et Linux. Hex transcrit sur votre appareil et colle le texte dans n'importe quelle app, si bien que l'audio ne quitte jamais l'appareil.",
        },
        opentunnel: {
          body: "Un CLI et un SDK qui donnent une URL HTTPS publique aux apps de votre machine. Le TLS se termine sur votre machine, si bien que le relais ne voit jamais le texte en clair.",
        },
      },
      learnMore: "Pour en savoir plus, rendez-vous sur [anoma.ly](site).",
    },
    about: {
      title: "À propos d'OpenCode",
      body: "Des descriptions d'OpenCode et de ses produits, en version longue et courte, prêtes à copier.",
      boilerplate: {
        long: "OpenCode est un agent de code open source. Il existe en app desktop, en interface terminal, en app mobile et en SDK, et il fonctionne avec les modèles de n'importe quel fournisseur, dont Claude, GPT et Gemini. OpenCode est sous licence MIT et développé par Anomaly. Il compte plus de 220 000 étoiles sur GitHub et plus de 1 000 contributeurs, et plus de 22 millions de développeurs l'utilisent chaque mois.",
        short:
          "OpenCode est un agent de code open source d'Anomaly, avec des apps desktop, terminal et mobile, et un SDK.",
      },
      products: {
        "opencode-console": {
          long: "OpenCode Console est l'app web où développeurs et équipes achètent et gèrent l'accès aux modèles d'IA pour OpenCode et d'autres agents de code. Elle propose une inférence à l'usage pour les modèles frontier et open-weight, facturée à la requête sur des crédits prépayés, ainsi que les abonnements OpenCode Go. Les équipes disposent d'espaces de travail avec les rôles Member, Admin et Owner, de plafonds de dépenses par espace et par utilisateur, du SSO avec Okta, Microsoft Entra ID ou Google Workspace, et de SCIM. Console prend en charge plus de 30 fournisseurs, pour que les équipes connectent les comptes qu'elles ont déjà, et sa propre inférence reste optionnelle. Elle se trouve sur opencode.ai/console.",
          short:
            "OpenCode Console est l'app web d'Anomaly pour l'accès à l'usage aux modèles d'IA, les abonnements OpenCode Go et les contrôles d'équipe comme les budgets et le SSO.",
          name: "OpenCode Console",
        },
        "opencode-go": {
          long: "OpenCode Go est un abonnement pour les développeurs qui veulent un prix mensuel fixe pour les modèles de code. Go coûte 10 $/mois, Go Plus coûte 40 $/mois avec des limites plus élevées, et Go Teams coûte 20 $/mois par membre. Chaque offre inclut une sélection de modèles testés pour le code agentique. Les limites d'usage sont des montants mensuels en dollars pour chaque modèle, avec des quotas glissants sur 5 heures et à la semaine de 20% et 50% de la limite mensuelle. Les abonnés peuvent recharger du crédit, basculer sur un solde à l'usage et résilier à tout moment. Go fonctionne avec OpenCode et d'autres agents. Il se trouve sur opencode.ai/console/go.",
          short:
            "OpenCode Go est un abonnement mensuel d'Anomaly qui donne aux développeurs des limites d'usage mensuelles sur une sélection de modèles de code, dès 10 $/mois.",
        },
        "opencode-data": {
          long: "OpenCode Data est un tableau de bord public qui montre quels modèles d'IA les développeurs utilisent dans OpenCode et comment cette répartition évolue. Il publie un classement des meilleurs modèles, l'usage des tokens, les coûts par session et par token, les taux de cache, les parts de marché et une répartition par pays. Les chiffres sont agrégés toutes les heures, avec des jours et des semaines en UTC. Les nombres d'utilisateurs et de sessions sont approximatifs, et les coûts reposent sur les prix catalogue du catalogue de modèles OpenCode. Les journalistes peuvent le citer comme OpenCode Data (opencode.ai/data), avec l'heure de mise à jour affichée sur la page.",
          short:
            "OpenCode Data est un tableau de bord public sur opencode.ai/data qui classe les modèles d'IA selon leur usage réel dans OpenCode, avec tokens, coûts et parts de marché mis à jour toutes les heures.",
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
          text: "1 million+ téléchargements",
        },
        "opencode-1-0": {
          date: "Oct. 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "Déc. 2025",
          text: "Sortie de l'app desktop",
        },
        "10-million-downloads": {
          date: "Janv. 2026",
          text: "10 millions+ téléchargements",
        },
        "opencode-2-0": {
          date: "Sept. 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "Nov. 2026",
          text: "220 000+ étoiles GitHub",
        },
      },
    },
    news: {
      title: "Dernières versions",
      intro: "OpenCode sort souvent de nouvelles versions. Voici les plus récentes avec de nouvelles fonctionnalités.",
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
        "Images et courtes vidéos de chaque app, enregistrées à partir du vrai produit. Vous pouvez les utiliser pour écrire sur OpenCode.",
      note: "Toutes les captures utilisent le thème sombre. Les images et affiches sont des JPG jusqu'à 1920 × 1080, ou 1080 × 1350 en portrait. Les vidéos sont des clips MP4 sans son.",
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
              title: "Sessions en onglets",
            },
            "feature-2": {
              title: "Relire et commenter",
            },
            "feature-3": {
              title: "Voir dans le navigateur",
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
              title: "Approbations",
            },
            "feature-3": {
              title: "Sessions",
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
              title: "Demandez avec vos mots",
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
              title: "Réparer la CI en code",
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
      body: "Le symbole et le logotype Anomaly, en noir et en blanc. Les PNG font 2048 px de large.",
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
        "Téléchargez les logos et logotypes OpenCode dans un seul fichier ZIP. Pour les fichiers individuels, les variantes et les règles d'utilisation, consultez la ",
      link: {
        text: "page Marque",
      },
      usage:
        "Vous pouvez utiliser ces fichiers pour écrire sur OpenCode. Ne les modifiez pas, et ne laissez pas entendre qu'OpenCode soutient votre travail.",
    },
    product: {
      title: "Produit",
      items: {
        desktop: {
          name: "Desktop",
          body: "Lancez plusieurs agents à la fois, chacun dans son onglet, sur macOS, Windows et Linux. Relisez chaque changement en diff et prévisualisez-le.",
        },
        mobile: {
          name: "Mobile",
          body: "La plus récente des apps OpenCode. Appelez une session pour parler à l'agent, puis relisez et approuvez ses changements depuis votre téléphone, où que vous soyez.",
        },
        terminal: {
          name: "Terminal",
          body: "Une interface terminal qui fonctionne dans tout shell, éditeur ou serveur distant. Voyez chaque modification en diff et choisissez quelles commandes s'exécutent seules.",
        },
        sdk: {
          body: "Un client TypeScript typé pour vos scripts, jobs CI et outils. Créez des sessions, envoyez des prompts et diffusez chaque événement en temps réel.",
        },
      },
    },
    contact: {
      title: "Contact",
      items: {
        press: {
          title: "Presse",
          body: "Pour les journalistes et analystes. Nous ne répondons qu'aux demandes des médias.",
        },
        support: {
          title: "Support",
          body: "Pour obtenir de l'aide sur OpenCode, ouvrez une issue ou demandez à la communauté. Pour les questions de compte et de facturation, écrivez-nous.",
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
          body: "Signalez une vulnérabilité via GitHub. Sans réponse sous 6 jours ouvrés, écrivez-nous.",
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
    faq: {
      items: {},
    },
  },
  productDownloads: {
    sdk: {
      more: {
        label: "Lire la doc du SDK",
      },
    },
    mini: {
      lead: "Mini est inclus dans le CLI OpenCode. Installez-le avec l'une de ces commandes, puis lancez opencode mini.",
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
      "OpenCode Mobile est une télécommande pour OpenCode sur votre ordinateur. Vos sessions continuent de tourner sur l'ordinateur, et l'app les affiche et vous permet de les piloter.",
    steps: {
      "get-the-app": {
        title: "Installez l'app",
        body: "Installez la bêta d'OpenCode sur votre iPhone depuis TestFlight. L'app Android arrive bientôt.",
      },
      "run-this-on-your-computer": {
        title: "Lancez ceci sur votre ordinateur",
        body: "La commande affiche un lien à usage unique et un QR code. Ils ne servent qu'une fois et expirent au bout de 5 minutes.",
      },
      "scan-the-code": {
        title: "Scannez le code",
        body: "Scannez le QR code avec l'app, ou collez le lien. Les sessions récentes de votre ordinateur s'ouvrent sur votre téléphone.",
      },
    },
    note: "--remote se connecte via une adresse OpenTunnel, pour fonctionner depuis n'importe quel réseau. Sur le même Wi-Fi, lancez une fois opencode service set hostname 0.0.0.0, puis opencode pair.",
    facts: [
      "L'association fonctionne depuis n'importe quel réseau, car --remote se connecte via une adresse OpenTunnel.",
      "Le lien et le code ne servent qu'une fois et expirent au bout de 5 minutes.",
      "Laissez l'ordinateur allumé, car l'agent tourne dessus et non sur le téléphone.",
      "Sur le même Wi-Fi, lancez une fois opencode service set hostname 0.0.0.0, puis opencode pair.",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Créez, installez et partagez des plugins desktop.",
      link: "Nouveautés de la 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Les terminaux de l'app desktop survivent aux redémarrages.",
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
      text: "Une app desktop repensée.",
      link: "Nouveautés de la 2.2",
    },
  },
} satisfies ContentOverlay
