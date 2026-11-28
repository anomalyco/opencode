import type { ContentOverlay } from "./source"

export const content = {
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "Crie, instale e compartilhe plugins no Desktop.",
      link: "Veja as novidades da versão 2.2",
    },
    "desktop-terminals-now-survive-restarts": {
      text: "Os terminais do Desktop agora continuam abertos após reiniciar.",
      link: "Ver v2.2.4",
    },
    "agents-can-now-generate-images": {
      text: "Agentes agora podem gerar imagens.",
      link: "Ver v2.2.1",
    },
    "steer-your-sessions-from-your-phone": {
      text: "Conduza suas sessões pelo celular.",
      link: "Conheça o OpenCode Mobile",
    },
    "a-refreshed-desktop-app": {
      text: "O app para computador está de cara nova.",
      link: "Veja as novidades da versão 2.2",
    },
  },
  products: {
    desktop: {
      name: "Desktop",
      body: "Sessões, abas, diffs, navegador integrado e extensões no macOS, Windows e Linux.",
      action: "Baixar",
    },
    mobile: {
      name: "Mobile",
      body: "Inicie, conduza e aprove sessões pelo celular, onde você estiver.",
      action: "Baixar",
    },
    terminal: {
      name: "Terminal",
      body: "Uma interface de terminal rápida que funciona em qualquer shell, editor ou servidor remoto.",
      action: "Instalar",
    },
    sdk: {
      name: "SDK",
      body: "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas.",
      action: "Ver docs",
    },
    mini: {
      name: "Mini",
      body: "Interface de terminal minimalista. As respostas vão para o histórico de rolagem, com um prompt logo abaixo.",
      action: "Instalar",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | Desktop para macOS, Windows e Linux",
      description:
        "Execute quantos agentes do OpenCode quiser em paralelo, acompanhe cada mudança no navegador ao lado e retome as sessões em qualquer dispositivo. Para macOS, Windows e Linux.",
      intro:
        "Rode vários agentes ao mesmo tempo, cada sessão na sua própria aba. Revise cada mudança como diff, comente qualquer linha e confira o resultado no navegador integrado. Para macOS, Windows e Linux.",
      showcase: {
        "parallel-agents": {
          title: "Agentes em paralelo",
          body: "Inicie quantos agentes quiser e deixe todos trabalharem em paralelo. Alterne entre eles conforme terminam.",
        },
        "see-it-in-the-browser": {
          title: "Veja no navegador",
          body: "Seu app abre no navegador ao lado do agente. Assim, você e o agente veem cada mudança em tempo real.",
        },
        "on-every-device": {
          title: "Em todos os dispositivos",
          body: "Inicie agentes em qualquer um dos seus dispositivos e retome as sessões pelo Desktop, pelo terminal ou pelo celular.",
        },
        "extend-it": {
          title: "Vá além com plugins",
          body: "Conecte suas ferramentas e serviços para o agente trabalhar com o que você precisar. Ou peça ao OpenCode para criar os próprios plugins, com interface na barra lateral.",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile, suas sessões de código no celular",
      description:
        "Inicie e conduza sessões do OpenCode pelo celular. Fale com o agente enquanto ele roda no seu computador.",
      intro:
        "Inicie e conduza sessões pelo celular, de onde estiver. Faça uma chamada na sessão para falar com o agente ou abra qualquer sessão para retomar de onde parou. Tudo com OpenCode rodando no seu computador.",
      showcase: {
        voice: {
          title: "Voz",
          body: "Faça uma chamada na sessão e diga o que precisa. O agente responde em voz alta.",
        },
        sessions: {
          title: "Sessões",
          body: "Abra qualquer sessão para ver o andamento e retome de onde parou.",
        },
        results: {
          title: "Resultados",
          body: "Assim que o agente termina a tarefa, você ouve na chamada o que mudou.",
        },
      },
    },
    terminal: {
      title: "OpenCode | Interface de terminal do agente de codificação de código aberto",
      description:
        "Uma interface de terminal rápida para o OpenCode que funciona em qualquer shell, editor ou servidor remoto. Descreva o que quer, veja cada edição como diff e aprove comandos.",
      intro:
        "Uma interface de terminal rápida para qualquer shell, editor ou servidor remoto. Descreva o que quer com suas próprias palavras, acompanhe cada edição no diff e escolha quais comandos rodam automaticamente.",
      features: {
        "any-terminal": {
          title: "Qualquer terminal",
          body: "Funciona em qualquer shell, no terminal do seu editor ou em um servidor remoto.",
        },
        "diffs-in-the-timeline": {
          title: "Diffs na linha do tempo",
          body: "Veja cada edição como diff na linha do tempo, conforme o agente a faz.",
        },
        "pick-up-later": {
          title: "Continue depois",
          body: "Retome a última sessão com -c, ou qualquer uma com -s.",
        },
        "one-off-runs": {
          title: "Execuções avulsas",
          body: "opencode run envia uma mensagem e imprime a resposta.",
        },
        "agents-and-commands": {
          title: "Agentes e comandos",
          body: "Troque de agente com shift+tab e abra todos os comandos com ctrl+p.",
        },
        "auto-approve": {
          title: "Autoaprovação",
          body: "Rode com --auto para permitir toda ação que você não negou.",
        },
        "any-server": {
          title: "Qualquer servidor",
          body: "Conecte-se a um servidor OpenCode pela URL com --server.",
        },
        "usage-stats": {
          title: "Estatísticas de uso",
          body: "opencode stats mostra estatísticas de uso para compartilhar.",
        },
      },
      showcase: {
        "ask-in-plain-words": {
          title: "Peça em palavras simples",
          body: "Digite o que quer, e o agente mostra o plano enquanto trabalha.",
        },
        "approve-what-runs": {
          title: "Aprove o que roda",
          body: "Edições aparecem como diffs, e comandos esperam sua permissão.",
        },
        "make-it-yours": {
          title: "Do seu jeito",
          body: "Troque de tema com uma tecla, do padrão ao tokyonight e outros.",
        },
        mini: {
          title: "Mini",
          body: "Execute opencode mini e veja as respostas no histórico de rolagem do seu terminal.",
        },
      },
    },
    sdk: {
      title: "OpenCode | SDK TypeScript para scripts, jobs de CI e ferramentas",
      description:
        "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas. O cliente TypeScript tipado cria sessões, envia prompts e transmite cada evento em tempo real.",
      intro:
        "Controle o OpenCode pelos seus scripts, jobs de CI e ferramentas. O SDK roda o OpenCode dentro do seu processo, com sua configuração e seus modelos, e o cliente tipado cria sessões, envia prompts e transmite cada evento.",
      features: {
        "typescript-client": {
          title: "Cliente TypeScript",
          body: "Requisições e eventos tipados, com os mesmos valores de @opencode/client.",
        },
        "sessions-from-code": {
          title: "Sessões pelo código",
          body: "Crie sessões e envie prompts de qualquer script.",
        },
        "any-model": {
          title: "Qualquer modelo",
          body: "Usa os modelos da sua configuração do OpenCode.",
        },
        "npm-or-bun": {
          title: "npm ou bun",
          body: "Instale com npm i @opencode/sdk ou bun add @opencode/sdk.",
        },
        "in-process-host": {
          title: "Host no processo",
          body: "Roda o OpenCode na memória, sem passar pela rede.",
        },
        "your-plugins": {
          title: "Seus plugins",
          body: "Passe seus próprios plugins ao criar o host no processo.",
        },
        "promise-or-effect": {
          title: "Promise ou Effect",
          body: "Uma API Promise e uma API Effect com os mesmos valores.",
        },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "Rode o OpenCode em um Durable Object da Cloudflare no Workers.",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "Corrija o CI pelo código",
          body: "Um script curto pede ao OpenCode para corrigir os testes que falharam e executa os testes de novo.",
        },
        "follow-every-step": {
          title: "Acompanhe cada passo",
          body: "Transmita eventos para ver cada ferramenta que o agente chama, em tempo real.",
        },
        "build-your-own-tools": {
          title: "Crie suas ferramentas",
          body: "Integre o OpenCode a bots, dashboards e fluxos de trabalho com poucas linhas.",
        },
        "in-your-process": {
          title: "No seu processo",
          body: "Roda o OpenCode no seu processo, com sua configuração e seus modelos.",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini, uma interface de terminal minimalista para o agente",
      description:
        "O Mini roda OpenCode em uma interface de terminal minimalista. As respostas vão para o histórico de rolagem do terminal. Só o prompt e a linha de status ficam na parte de baixo.",
      intro:
        "Uma interface de terminal minimalista para OpenCode. Execute opencode mini e as respostas vão direto para o histórico de rolagem do terminal. Você pode rolar, buscar e copiar como em qualquer outra saída. Só o prompt e uma linha de status ficam na parte de baixo.",
      features: {
        "your-scrollback": {
          title: "Seu histórico de rolagem",
          body: "As respostas ficam no histórico normal do terminal.",
        },
        "one-prompt": {
          title: "Um prompt",
          body: "Agente, modelo, contexto e custo em uma linha de status.",
        },
        permissions: {
          title: "Permissões",
          body: "Permita edições e comandos na área do prompt.",
        },
        "how-much-shows": {
          title: "Quanto aparece",
          body: "Discreto, padrão ou tudo, para raciocínio e saída de ferramentas.",
        },
        "pick-up-later": {
          title: "Continue depois",
          body: "Retome a última sessão com -c, ou qualquer uma com -s.",
        },
        "same-opencode": {
          title: "Mesmo OpenCode",
          body: "O mesmo servidor, agentes e modelos dos outros apps.",
        },
        agents: {
          title: "Agentes",
          body: "Troque de agente direto no prompt.",
        },
        compact: {
          title: "Compactar",
          body: "Compacte uma sessão longa com /compact.",
        },
      },
    },
  },
  extensionCard: {
    name: "Extensões",
    body: "Use o OpenCode no VS Code, ou no Zed e em outros editores via ACP.",
    action: "Instalar",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "Deixe os agentes usarem o navegador que você já usa.",
      title: "OpenCode | Browse, seu navegador para agentes de codificação",
      description:
        "Browse permite que OpenCode e outros clientes MCP usem seu próprio navegador. Os agentes leem, clicam, digitam, tiram capturas de tela e gravam abas. Em etapas de login ou 2FA, você assume o controle.",
      intro:
        "Um servidor MCP e uma extensão para Chromium que dão aos agentes acesso ao seu próprio navegador, com suas abas, seus logins e suas extensões. As abas abrem em grupos, em segundo plano, sem atrapalhar você. Os agentes leem páginas, clicam, digitam, tiram capturas de tela e gravam abas. Se precisarem de login, 2FA ou pagamento, passam o controle da aba para você e voltam ao trabalho quando você clica em Continue.",
      features: {
        "your-real-browser": {
          title: "Seu próprio navegador",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera e Chromium.",
        },
        "out-of-your-way": {
          title: "Sem atrapalhar",
          body: "As abas dos agentes abrem em segundo plano, em grupos recolhidos.",
        },
        handoffs: {
          title: "Sua vez",
          body: "Faça você mesmo o login ou o 2FA e clique em Continue.",
        },
        "lend-a-tab": {
          title: "Empreste uma aba",
          body: "Clique no botão da barra para passar a um agente uma aba aberta.",
        },
        "record-and-capture": {
          title: "Grave e capture",
          body: "Capturas de tela, gravações de abas e tráfego de rede.",
        },
        "any-mcp-client": {
          title: "Qualquer cliente MCP",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed e muitos outros.",
        },
        "all-your-logins": {
          title: "Todos os seus logins",
          body: "Os agentes usam os sites em que você já está conectado. Sem chaves, sem configuração.",
        },
        "allowed-sites": {
          title: "Sites permitidos",
          body: "Mantenha a aba de um agente nos sites que você indicar.",
        },
      },
      install:
        "Instale primeiro a [extensão do Chrome] e siga os passos que ela indicar. Se precisar instalar a CLI diretamente, o que normalmente não é necessário, use uma destas opções.",
    },
  },
  apps: {
    browse: {
      category: "Controle do navegador para agentes",
      body: "Deixe seu agente usar seu próprio navegador, com seus logins e abas.",
    },
    hex: {
      category: "Ditado por voz",
      body: "Ditado por voz direto no dispositivo, em qualquer app.",
    },
    opentunnel: {
      category: "Túneis locais",
      body: "URLs HTTPS públicas para apps locais.",
    },
    opentui: {
      category: "Biblioteca",
      body: "Uma biblioteca para interfaces de terminal.",
    },
  },
  getStarted: {
    title: "Comece agora",
    lead: "O jeito mais fácil de começar é baixar o OpenCode e usar os modelos grátis. Não precisa de conta. Para acessar mais modelos, use uma assinatura que você já tem ou use o OpenCode Go.",
    phrases: {
      "download-opencode": {
        text: "baixar o OpenCode",
      },
      "free-models": {
        text: "modelos grátis",
      },
      "your-own-subscription": {
        text: "sua própria assinatura",
      },
      "a-subscription-you-already-have": {
        text: "uma assinatura que você já tem",
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
        title: "Baixe",
        line: "Desktop, terminal ou celular.",
      },
      "use-free-models": {
        title: "Use modelos grátis",
        line: "OpenCode já inclui modelos grátis. Não precisa de conta.",
      },
      "add-more-models": {
        title: "Adicione mais modelos",
        line: "Use uma assinatura que você já tem ou escolha entre os modelos selecionados do OpenCode Go, a partir de $10/mês.",
      },
    },
    sentence:
      "Baixe o OpenCode, comece com modelos grátis e, quando quiser mais, use sua assinatura ou o OpenCode Go.",
  },
  byos: {
    title: "Use suas assinaturas",
    headline: "Use as assinaturas que você já tem.",
    line: "Entre com ChatGPT Plus ou Pro, ou com GitHub Copilot. Ou use uma assinatura OpenCode.",
    yours: {
      label: "Sua assinatura",
      items: {
        "chatgpt-plus-pro": {
          name: "ChatGPT Plus/Pro",
        },
        "github-copilot": {
          name: "GitHub Copilot",
        },
      },
    },
    planLinks: ["assinatura OpenCode", "OpenCode Go"],
    ours: {
      label: "Planos OpenCode",
    },
  },
  brand: {
    hero: {
      copy: {
        text: "Regras para agentes",
        copied: "Regras copiadas",
      },
    },
    naming: {
      title: "Nome",
      body: "Escreva OpenCode como uma palavra só, com O e C maiúsculos. Não escreva Opencode, Open Code, OpenCode AI nem Open-Code.",
      code: "Use `opencode` em minúsculas só em código e nomes de pacotes, como `opencode-figma` ou `@acme/opencode-plugin`.",
    },
    families: {
      logo: {
        title: "Logo",
        body: "O logo sem o nome, para ícones de apps, avatares e outros espaços pequenos. As versões quadradas têm margens para usos que exigem um recorte quadrado.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
          "square-light": {
            name: "Quadrado, claro",
          },
          "square-dark": {
            name: "Quadrado, escuro",
          },
        },
      },
      wordmark: {
        title: "Logotipo",
        body: "O nome completo com as letras do OpenCode. Use sempre que houver espaço para escrever o nome por extenso.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
        },
      },
      "simple-wordmark": {
        title: "Logotipo simples",
        body: "Uma versão do logotipo em uma só cor, para impressão, bordado e lugares que só permitem uma cor.",
        assets: {
          light: {
            name: "Claro",
          },
          dark: {
            name: "Escuro",
          },
        },
      },
    },
    icons: {
      title: "Avatares",
      body: "Avatares quadrados de 1024px para Slack, Discord, GitHub e outros perfis. O fundo preenche todo o quadrado, e o logo cabe inteiro mesmo com um recorte circular.",
      items: {
        dark: {
          name: "Escuro",
        },
        light: {
          name: "Claro",
        },
      },
    },
    colors: {
      title: "Cores",
      body: "O logo e o logotipo usam uma tinta em três opacidades, com uma tinta mais clara para fundos escuros. Os valores abaixo são as cores nos arquivos padrão. Use-as apenas no logo e no logotipo, não em outros textos ou fundos. Clique em um valor para copiá-lo.",
      palettes: {
        light: {
          name: "Claro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "O contorno do logo e as letras de “code”.",
            },
            "ink-70": {
              name: "Tinta 70%",
              use: "As letras de “open”.",
              ink: "A tinta com 70% de opacidade.",
            },
            "ink-20": {
              name: "Tinta 20%",
              use: "O tom interno do logo.",
              ink: "A tinta com 20% de opacidade.",
            },
          },
        },
        dark: {
          name: "Escuro",
          swatches: {
            ink: {
              name: "Tinta",
              use: "O contorno do logo e as letras de “code”.",
            },
            "ink-72": {
              name: "Tinta 72%",
              use: "As letras de “open”.",
              ink: "A tinta com 72% de opacidade.",
            },
            "ink-28": {
              name: "Tinta 28%",
              use: "O tom interno do logo.",
              ink: "A tinta com 28% de opacidade.",
            },
          },
        },
      },
    },
    variants: {
      title: "Variantes",
      body: "Escolha a versão que deixa o logo nítido no seu fundo, escura em fundos claros e clara em fundos escuros. O logo e o logotipo são arquivos separados, então use um ou outro.",
      groups: {
        default: {
          name: "Padrão",
          body: "Use esta versão na maioria dos casos. O tom interno é transparente. Em fundo branco ou preto, o resultado é igual ao das versões em dois tons de cinza. Em fotos, degradês ou fundos coloridos, o fundo aparece através do logo.",
          rows: {
            logo: {
              title: "Logo",
              tiles: {
                dark: {
                  name: "Escuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Escuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
          },
        },
        simple: {
          name: "Simples",
          body: "Uma cor, com miolos abertos e sem tom interno. Use em fundos de cor chapada, em impressão de uma cor e onde não der para usar os cinzas, o simples escuro em cores claras e o simples claro em cores escuras.",
          rows: {
            wordmark: {
              title: "Logotipo",
              tiles: {
                dark: {
                  name: "Escuro",
                },
                light: {
                  name: "Claro",
                },
              },
            },
          },
        },
      },
    },
    usage: {
      title: "Uso",
      body: "Use as versões claras em fundos claros e as escuras em fundos escuros. O logo e o logotipo são separados. Use um ou outro, nunca os dois juntos.",
      stroke: {
        title: "Um traço",
        body: "As regras de espaçamento desta página são medidas em traços. Um traço é a espessura do contorno do logo, um quarto da sua largura, então o logo tem 4 traços de largura e 5 de altura.",
      },
      clearSpace: {
        title: "Área de respiro",
        body: "Deixe pelo menos dois traços de espaço em todos os lados do logo e do logotipo. No logo, um traço é a espessura do contorno, um quarto da largura. No logotipo, é a espessura das letras, um sétimo da altura.",
      },
      pixels: {
        title: "Pixels inteiros",
        body: "As proporções do logo são fixas em 4:5, e um traço é um quarto da largura. Redimensione em passos de 4 × 5px, para que cada borda e cada traço caia em um pixel inteiro.",
        do: "manter cada borda e o traço de 4px em pixels inteiros.",
        dont: "use tamanhos fora de 4:5, ou as bordas caem entre pixels e ficam borradas.",
        sizes: {
          logo: {
            title: "Logo",
          },
          wordmark: {
            title: "Logotipo",
          },
        },
      },
      minimumTitle: "Tamanhos mínimos",
      minimum: {
        logo: {
          title: "Logo",
          body: "Pelo menos 16 × 20px, com traço de 4px. Menor que isso, fica borrado.",
        },
        wordmark: {
          title: "Logotipo",
          body: "Pelo menos 117 × 21px, com traço de 3px. Menor que isso, fica borrado.",
        },
      },
    },
    donts: {
      title: "Não faça",
      body: "Erros comuns a evitar ao usar o logo e o logotipo.",
      examples: {
        "two-tone": {
          caption: "aplique outras cores ao logo.",
        },
        bright: {
          caption: "use uma única cor vibrante.",
        },
        gradient: {
          caption: "preencha o logo com degradê.",
        },
        inverted: {
          caption: "inverta os tons.",
        },
        stretch: {
          caption: "estique nem achate o logo.",
        },
        shadow: {
          caption: "adicione sombras.",
        },
        glow: {
          caption: "adicione brilhos nem contornos.",
        },
        lockup: {
          caption: "coloque outras palavras ao lado do logo.",
        },
        "low-contrast": {
          caption: "use cinza sobre cinza com pouco contraste.",
        },
        color: {
          caption: "coloque o logo em dois tons de cinza sobre fundo colorido. Isso tira a nitidez dos cinzas.",
        },
      },
    },
    integrations: {
      title: "Integrações",
      body: "Se seu plugin, provedor ou ferramenta funciona com OpenCode, ou se seu projeto foi criado com ele, você pode dizer isso. Use um selo ou uma composição de parceria e deixe claro, pelo nome, que o projeto é seu.",
      badges: {
        body: "Coloque um selo no seu README, docs ou site com link para opencode.ai. Escolha o arquivo claro ou escuro para o seu fundo (o HTML alterna sozinho) e não mude as cores nem o texto.",
        sizes: "Cada estilo está disponível em 20, 32 e 44px (Shields só em 20px), em SVG e PNG a 2×.",
        mono: "Cada arquivo tem versões com texto em OpenMono. Acrescente -mono antes da extensão, como em opencode-works-with-a-light-20-mono.svg, ou use -mono-caps para OpenMono em maiúsculas.",
        groups: {
          "works-with": {
            title: "Funciona com",
            alt: "Funciona com OpenCode",
            body: "Para plugins, provedores e ferramentas que rodam com o OpenCode.",
          },
          "built-with": {
            title: "Feito com",
            alt: "Feito com OpenCode",
            body: "Para projetos feitos com o OpenCode.",
          },
        },
        styles: {
          a: {
            name: "Moldura",
          },
          c: {
            name: "Células",
          },
          f: {
            name: "Sólido",
          },
          g: {
            name: "Shields",
          },
        },
      },
      lockup: {
        title: "Composição de parceria",
        body: "Coloque o logo do OpenCode e o logo do parceiro lado a lado, com um × entre eles. Deixe 3 traços de espaço de cada lado do ×, ajuste o logo do parceiro para parecer tão alto quanto o do OpenCode e mantenha área de respiro em volta de todo o conjunto.",
        partners: {
          github: {
            name: "GitHub",
          },
        },
      },
      naming: {
        title: "Nome do seu projeto",
        body: "Comece pelo seu próprio nome, para deixar claro que o projeto é seu.",
        rule: "Escreva `Linear for OpenCode` ou chame o pacote de `opencode-linear`. Não escreva `OpenCode Linear` nem `Linear by OpenCode`.",
      },
    },
    trademarks: {
      title: "Marcas",
      body: "OpenCode e o logo do OpenCode são marcas da Anomaly. Não use essas marcas para sugerir apoio ou patrocínio da Anomaly, no nome do seu produto ou da sua empresa, nem em produtos promocionais sem autorização.",
      contact: {
        before: "Em caso de dúvidas, escreva para ",
        after: ".",
      },
    },
  },
  press: {
    title: "OpenCode | Kit de imprensa com dados da empresa e materiais da marca",
    description:
      "O kit de imprensa reúne dados sobre o OpenCode e a Anomaly, a empresa que o criou, além de logos e logotipos para baixar e um contato para a imprensa.",
    hero: {
      title: "Imprensa",
      body: "Dados, materiais da marca e contatos para escrever sobre OpenCode e Anomaly.",
    },
    company: {
      title: "Sobre a Anomaly",
      lead: "A Anomaly é a empresa por trás do OpenCode. Ela cria ferramentas de código aberto para desenvolvedores.",
      more: "Outros projetos incluem SST e OpenTUI, todos de código aberto no [GitHub](github).",
      learnMore: "Para saber mais, acesse [anoma.ly](site).",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "O agente de codificação de código aberto, com apps para computador, terminal e celular, além de um SDK. Licença MIT e mais de 220.000 estrelas no GitHub.",
        },
        sst: {
          name: "SST",
          body: "Um framework para criar apps full-stack na sua própria infraestrutura. De código aberto desde 2020, com licença MIT e mais de 26.000 estrelas no GitHub.",
        },
        opentui: {
          name: "OpenTUI",
          body: "Uma biblioteca para interfaces de terminal em TypeScript, React ou Solid, com núcleo em Zig. O OpenCode a usa em produção. Mais de 13.000 estrelas no GitHub.",
        },
        "models-dev": {
          name: "Models.dev",
          body: "Um banco de dados de código aberto com especificações, preços e recursos de modelos de IA, além de uma API pública. São mais de 8.900 modelos de mais de 200 provedores.",
        },
        hex: {
          name: "Hex",
          body: "Ditado por voz para Mac, Windows e Linux. Hex transcreve no seu dispositivo e cola o texto em qualquer app. O áudio nunca sai do dispositivo.",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "Uma CLI e um SDK que dão aos apps locais uma URL HTTPS pública. O TLS termina na sua máquina, então o relay nunca tem acesso ao texto não criptografado.",
        },
      },
    },
    about: {
      title: "Sobre o OpenCode",
      body: "Descrições do OpenCode e de seus produtos em versões longa e curta, prontas para copiar.",
      boilerplate: {
        long: "OpenCode é um agente de codificação de código aberto. Está disponível como app para computador, interface de terminal, app para celular e SDK. Funciona com modelos de qualquer provedor, incluindo Claude, GPT e Gemini. Desenvolvido pela Anomaly sob licença MIT, o projeto tem mais de 220.000 estrelas no GitHub e mais de 1.000 colaboradores. Mais de 22 milhões de desenvolvedores usam OpenCode todo mês.",
        short:
          "OpenCode é um agente de codificação de código aberto da Anomaly, com apps para computador, terminal e celular, além de um SDK.",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "No app web OpenCode Console, desenvolvedores e equipes compram e gerenciam o acesso a modelos de IA para OpenCode e outros agentes de codificação. A inferência para modelos de fronteira e de pesos abertos é cobrada por requisição, com créditos pré-pagos. Também há assinaturas do OpenCode Go. As equipes têm espaços de trabalho com funções Member, Admin e Owner, limites de gastos por espaço de trabalho e por usuário, login único com Okta, Microsoft Entra ID ou Google Workspace, e SCIM. O Console é compatível com mais de 30 provedores. As equipes podem conectar as contas que já têm, e usar a inferência do OpenCode é opcional. Acesse opencode.ai/console.",
          short:
            "OpenCode Console é o app web da Anomaly para acessar modelos de IA pagando por uso, assinar o OpenCode Go e gerenciar equipes com limites mensais e login único.",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go é uma assinatura para desenvolvedores que querem pagar um preço mensal fixo por modelos de codificação. O Go custa $10/mês, o Go Plus custa $40/mês e tem limites maiores, e o Go Teams custa $20/mês por membro. Cada plano inclui uma seleção de modelos testados para codificação com agentes. Cada modelo tem um limite de uso mensal em dólares, com cotas de uso de 20% e 50% desse limite em janelas móveis de 5 horas e uma semana, respectivamente. Assinantes podem recarregar o crédito, usar o saldo para pagar por uso e cancelar quando quiserem. O Go funciona com OpenCode e outros agentes. Acesse opencode.ai/console/go.",
          short:
            "OpenCode Go é uma assinatura mensal da Anomaly com limites de uso mensais para uma seleção de modelos de codificação, a partir de $10/mês.",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "O OpenCode Data é um painel público que mostra quais modelos de IA os desenvolvedores usam no OpenCode e como essa combinação muda ao longo do tempo. Ele publica um ranking dos principais modelos, uso de tokens, custos por sessão e por token, taxas de cache, participação de mercado e uma divisão por país. Os números são agregados a cada hora, com dias e semanas em UTC. As contagens de usuários e sessões são aproximadas, e os custos usam preços de tabela do catálogo de modelos do OpenCode. Jornalistas podem citá-lo como OpenCode Data (opencode.ai/data), com o horário de atualização mostrado na página.",
          short:
            "O OpenCode Data é um painel público em opencode.ai/data que classifica modelos de IA pelo uso real no OpenCode, com tokens, custos e participação de mercado atualizados a cada hora.",
        },
      },
    },
    facts: {
      title: "Em resumo",
      items: {
        license: {
          label: "Licença",
        },
        "first-release": {
          label: "Primeira versão",
        },
        "made-by": {
          label: "Feito por",
        },
      },
    },
    milestones: {
      title: "Marcos",
      items: {
        "first-release-v0-0-1": {
          date: "abr. 2025",
          text: "Primeira versão, v0.0.1",
        },
        "1-million-downloads": {
          date: "out. 2025",
          text: "1 mi+ de downloads",
        },
        "opencode-1-0": {
          date: "out. 2025",
          text: "OpenCode 1.0",
        },
        "desktop-app-ships": {
          date: "dez. 2025",
          text: "Lançamento do Desktop",
        },
        "10-million-downloads": {
          date: "jan. 2026",
          text: "10 mi+ de downloads",
        },
        "opencode-2-0": {
          date: "set. 2026",
          text: "OpenCode 2.0",
        },
        "220-000-github-stars": {
          date: "nov. 2026",
          text: "220.000+ estrelas no GitHub",
        },
      },
    },
    news: {
      title: "Últimas versões",
      intro: "O OpenCode lança versões com frequência. Estas são as mais recentes com novos recursos.",
      changelog: {
        text: "Changelog completo",
      },
      feed: {
        text: "Feed RSS",
      },
    },
    media: {
      title: "Mídia",
      intro:
        "Imagens e vídeos curtos de cada app, gravados do produto real. Você pode usá-los para escrever sobre o OpenCode.",
      note: "Todas as capturas usam o tema escuro. Imagens e capas são JPGs de até 1920 × 1080, ou 1080 × 1350 na vertical. Os vídeos são clipes MP4 sem som.",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": {
              title: "Vídeo do Desktop",
            },
            "frame-1": {
              title: "Imagem do Desktop 1",
            },
            "frame-2": {
              title: "Imagem do Desktop 2",
            },
            "frame-3": {
              title: "Imagem do Desktop 3",
            },
            "frame-4": {
              title: "Imagem do Desktop 4",
            },
            "feature-1": {
              title: "Agentes em paralelo",
            },
            "feature-2": {
              title: "Veja no navegador",
            },
            "feature-3": {
              title: "Em todos os dispositivos",
            },
            "locked-portrait": {
              title: "Vídeo do Desktop, vertical",
            },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": {
              title: "Vídeo do Mobile",
            },
            "frame-1": {
              title: "Imagem do Mobile 1",
            },
            "frame-2": {
              title: "Imagem do Mobile 2",
            },
            "frame-3": {
              title: "Imagem do Mobile 3",
            },
            "feature-1": {
              title: "Voz",
            },
            "feature-2": {
              title: "Sessões",
            },
            "feature-3": {
              title: "Resultados",
            },
            "locked-portrait": {
              title: "Vídeo do Mobile, vertical",
            },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": {
              title: "Vídeo do Terminal",
            },
            "frame-1": {
              title: "Imagem do Terminal 1",
            },
            "frame-2": {
              title: "Imagem do Terminal 2",
            },
            "frame-3": {
              title: "Imagem do Terminal 3",
            },
            "frame-4": {
              title: "Imagem do Terminal 4",
            },
            "feature-1": {
              title: "Peça em palavras simples",
            },
            "feature-2": {
              title: "Aprove o que roda",
            },
            "feature-3": {
              title: "Do seu jeito",
            },
            "locked-portrait": {
              title: "Vídeo do Terminal, vertical",
            },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": {
              title: "Vídeo do SDK",
            },
            "frame-1": {
              title: "Imagem do SDK 1",
            },
            "frame-2": {
              title: "Imagem do SDK 2",
            },
            "frame-3": {
              title: "Imagem do SDK 3",
            },
            "frame-4": {
              title: "Imagem do SDK 4",
            },
            "feature-1": {
              title: "Corrija o CI",
            },
            "feature-2": {
              title: "Acompanhe cada passo",
            },
            "feature-3": {
              title: "Crie suas ferramentas",
            },
            "locked-portrait": {
              title: "Vídeo do SDK, vertical",
            },
          },
        },
      },
    },
    people: {
      title: "Pessoas",
    },
    anomalyLogo: {
      title: "Logo da Anomaly",
      body: "O símbolo e o logotipo da Anomaly, em preto e branco. Os PNGs têm 2048 px de largura.",
      assets: {
        "mark-black": {
          name: "Símbolo, preto",
        },
        "mark-white": {
          name: "Símbolo, branco",
        },
        "wordmark-black": {
          name: "Logotipo, preto",
        },
        "wordmark-white": {
          name: "Logotipo, branco",
        },
      },
      avatars: {
        body: "Avatares quadrados para X, GitHub, Slack, LinkedIn e outros perfis. O símbolo fica bem dentro do círculo, então resiste a um corte redondo. Os PNGs têm 1024 e 400 px de largura.",
        items: {
          "avatar-dark": { name: "Avatar, escuro" },
          "avatar-light": { name: "Avatar, claro" },
        },
      },
      all: {
        text: "Baixar tudo",
      },
    },
    coverage: {
      title: "Na mídia",
    },
    brand: {
      title: "Marca",
      before:
        "Baixe os logos e logotipos do OpenCode em um único arquivo ZIP. Para arquivos individuais, variantes e regras de uso, acesse a página da ",
      link: {
        text: "marca",
      },
      after: ".",
      usage:
        "Você pode usar estes arquivos para escrever sobre o OpenCode. Não os altere e não sugira que o OpenCode apoia o seu trabalho.",
    },
    product: {
      title: "Produto",
      items: {
        desktop: {
          name: "Desktop",
          body: "Rode vários agentes ao mesmo tempo, cada um na sua aba, no macOS, Windows e Linux. Revise cada mudança como diff e veja o resultado.",
        },
        mobile: {
          name: "Mobile",
          body: "O app mais novo do OpenCode. Faça uma chamada na sessão para falar com o agente e depois revise e aprove as mudanças pelo celular, de onde estiver.",
        },
        terminal: {
          name: "Terminal",
          body: "Uma interface de terminal que funciona em qualquer shell, editor ou servidor remoto. Veja cada edição como diff e escolha quais comandos rodam sozinhos.",
        },
        sdk: {
          name: "SDK",
          body: "Um cliente TypeScript tipado para scripts, jobs de CI e suas ferramentas. Crie sessões, envie prompts e transmita cada evento conforme chega.",
        },
      },
    },
    contact: {
      title: "Contato",
      items: {
        press: {
          title: "Imprensa",
          body: "Para jornalistas e analistas. Respondemos só a pedidos da mídia.",
        },
        support: {
          title: "Suporte",
          body: "Para ajuda com o OpenCode, abra uma issue ou pergunte à comunidade. Para dúvidas de conta e cobrança, mande um e-mail.",
          links: {
            "github-issues": {
              text: "Issues no GitHub",
            },
            "help-anoma-ly": {
              text: "help@anoma.ly",
            },
          },
        },
        security: {
          title: "Segurança",
          body: "Reporte uma vulnerabilidade pelo GitHub. Se ninguém responder em 6 dias úteis, mande um e-mail.",
          links: {
            "report-a-vulnerability": {
              text: "Reportar uma vulnerabilidade",
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
          name: "Script",
        },
      },
    },
    extensions: {
      title: "Extensões",
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
        label: "Ler a documentação do SDK",
      },
    },
    mini: {
      lead: "Mini já vem com a OpenCode CLI. Use uma das opções de instalação e execute opencode mini.",
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
    title: "Conecte seu celular",
    cardTitle: "Pareie seu celular com um comando",
    intro:
      "OpenCode Mobile funciona como controle remoto para OpenCode no seu computador. As sessões continuam rodando lá. Pelo app, você acompanha e conduz cada uma.",
    steps: {
      "get-the-app": {
        title: "Baixe o app",
        body: "Instale a versão beta do OpenCode no iPhone pelo TestFlight ou instale o app no seu celular Android.",
      },
      "run-this-on-your-computer": {
        title: "Execute o comando no computador",
        body: "O comando mostra um link e um código QR. Ambos são de uso único e expiram em 5 minutos.",
      },
      "scan-the-code": {
        title: "Leia o código",
        body: "Escaneie o código QR no app ou cole o link. As sessões recentes do computador abrem no celular.",
      },
    },
    note: "--remote conecta por um endereço OpenTunnel, então funciona de qualquer rede. Na mesma rede Wi-Fi, rode opencode service set hostname 0.0.0.0 uma vez e depois opencode pair.",
    facts: [
      "O pareamento funciona de qualquer rede, porque --remote conecta por um endereço OpenTunnel.",
      "O link e o código funcionam uma vez e expiram em 5 minutos.",
      "Deixe o computador ligado, porque o agente roda nele e não no celular.",
      "Na mesma rede Wi-Fi, rode opencode service set hostname 0.0.0.0 uma vez e depois opencode pair.",
    ],
  },
} satisfies ContentOverlay
