---
title: Solução de Problemas
description: Problemas comuns e como resolvê-los.
---

Para depurar problemas com o opencode, comece verificando os logs e os dados locais que ele armazena no disco.

---

## Logs

Os arquivos de log são gravados em:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Pressione `WIN+R` e cole `%USERPROFILE%\.local\share\opencode\log`

Os arquivos de log são nomeados com timestamps (por exemplo, `2025-01-09T123456.log`) e os 10 arquivos de log mais recentes são mantidos.

Você pode definir o nível de log com a opção de linha de comando `--log-level` para obter informações de depuração mais detalhadas. Por exemplo, `opencode --log-level DEBUG`.

---

## Armazenamento

O opencode armazena dados de sessão e outros dados do aplicativo no disco em:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Pressione `WIN+R` e cole `%USERPROFILE%\.local\share\opencode`

Este diretório contém:

- `auth.json` - Dados de autenticação como chaves de API, tokens OAuth
- `log/` - Logs do aplicativo
- `project/` - Dados específicos do projeto, como dados de sessão e mensagens
  - Se o projeto estiver dentro de um repositório Git, ele é armazenado em `./<project-slug>/storage/`
  - Se não for um repositório Git, ele é armazenado em `./global/storage/`

---

## Aplicativo de Desktop

O opencode Desktop executa um servidor opencode local (o sidecar `opencode-cli`) em segundo plano. A maioria dos problemas é causada por um plugin com mau funcionamento, um cache corrompido ou uma configuração de servidor incorreta.

### Verificações rápidas

- Saia completamente do aplicativo e reinicie-o.
- Se o aplicativo mostrar uma tela de erro, clique em **Reiniciar** e copie os detalhes do erro.
- Apenas macOS: menu `OpenCode` -> **Recarregar Webview** (ajuda se a interface estiver em branco/congelada).

---

### Desativando plugins

Se o aplicativo de desktop estiver travando ao iniciar, pendurado ou se comportando de maneira estranha, comece desativando os plugins.

#### Verificando a configuração global

Abra seu arquivo de configuração global e procure uma chave `plugin`.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (ou `~/.config/opencode/opencode.json`)
- **macOS/Linux** (instalações mais antigas): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Pressione `WIN+R` e cole `%USERPROFILE%\.config\opencode\opencode.jsonc`

Se você tiver plugins configurados, desative-os temporariamente removendo a chave ou definindo-a como um array vazio:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Verificando os diretórios de plugins

O opencode também pode carregar plugins locais do disco. Mova-os temporariamente para fora do caminho (ou renomeie a pasta) e reinicie o aplicativo de desktop:

- **Plugins globais**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Pressione `WIN+R` e cole `%USERPROFILE%\.config\opencode\plugins`
- **Plugins de projeto** (apenas se você usar configuração por projeto)
  - `<your-project>/.opencode/plugins/`

Se o aplicativo voltar a funcionar, reative os plugins um por um para descobrir qual está causando o problema.

---

### Limpando o cache

Se desativar plugins não ajudar (ou se a instalação de um plugin estiver travada), limpe o cache para que o opencode possa reconstruí-lo.

1. Saia completamente do opencode Desktop.
2. Exclua o diretório de cache:

- **macOS**: Finder -> `Cmd+Shift+G` -> cole `~/.cache/opencode`
- **Linux**: exclua `~/.cache/opencode` (ou execute `rm -rf ~/.cache/opencode`)
- **Windows**: Pressione `WIN+R` e cole `%USERPROFILE%\.cache\opencode`

3. Reinicie o opencode Desktop.

---

### Corrigindo problemas de conexão com o servidor

O opencode Desktop pode iniciar seu próprio servidor local (padrão) ou conectar-se a uma URL de servidor que você configurou.

Se você ver um diálogo **"Conexão Falhou"** (ou o aplicativo nunca passa da tela de inicialização), verifique se há uma URL de servidor personalizada.

#### Limpando a URL do servidor padrão do desktop

Na tela inicial, clique no nome do servidor (com o ponto de status) para abrir o seletor de Servidor. Na seção **Servidor padrão**, clique em **Limpar**.

#### Removendo `server.port` / `server.hostname` da sua configuração

Se seu `opencode.json(c)` contiver uma seção `server`, remova-a temporariamente e reinicie o aplicativo de desktop.

#### Verificando as variáveis de ambiente

Se você tiver `OPENCODE_PORT` definido em seu ambiente, o aplicativo de desktop tentará usar essa porta para o servidor local.

- Desfaça `OPENCODE_PORT` (ou escolha uma porta livre) e reinicie.

---

### Linux: Problemas com Wayland / X11

No Linux, algumas configurações do Wayland podem causar janelas em branco ou erros de compositor.

- Se você estiver no Wayland e o aplicativo estiver em branco/travando, tente iniciar com `OC_ALLOW_WAYLAND=1`.
- Se isso piorar as coisas, remova e tente iniciar sob uma sessão X11.

---

### Windows: Runtime do WebView2

No Windows, o opencode Desktop requer o **WebView2 Runtime** do Microsoft Edge. Se o aplicativo abrir em uma janela em branco ou não iniciar, instale/atualize o WebView2 e tente novamente.

---

### Windows: Problemas gerais de desempenho

Se você estiver enfrentando desempenho lento, problemas de acesso a arquivos ou problemas no terminal no Windows, tente usar [WSL (Windows Subsystem for Linux)](/docs/windows-wsl). O WSL fornece um ambiente Linux que funciona de forma mais integrada com os recursos do opencode.

---

### Notificações não aparecendo

O opencode Desktop só mostra notificações do sistema quando:

- as notificações estão habilitadas para o opencode nas configurações do seu sistema operacional, e
- a janela do aplicativo não está focada.

---

### Redefinindo o armazenamento do aplicativo de desktop (último recurso)

Se o aplicativo não iniciar e você não conseguir limpar as configurações pela interface, redefina o estado salvo do aplicativo de desktop.

1. Saia do opencode Desktop.
2. Encontre e exclua estes arquivos (eles estão no diretório de dados do aplicativo opencode Desktop):

- `opencode.settings.dat` (URL do servidor padrão do desktop)
- `opencode.global.dat` e `opencode.workspace.*.dat` (estado da interface como servidores/projetos recentes)

Para encontrar o diretório rapidamente:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (depois pesquise pelos nomes dos arquivos acima)
- **Linux**: pesquise em `~/.local/share` pelos nomes dos arquivos acima
- **Windows**: Pressione `WIN+R` -> `%APPDATA%` (depois pesquise pelos nomes dos arquivos acima)

---

## Obtendo ajuda

Se você estiver enfrentando problemas com o opencode:

1. **Relatar problemas no GitHub**

   A melhor maneira de relatar bugs ou solicitar recursos é através do nosso repositório no GitHub:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Antes de criar um novo problema, pesquise problemas existentes para ver se seu problema já foi relatado.

2. **Junte-se ao nosso Discord**

   Para ajuda em tempo real e discussão da comunidade, junte-se ao nosso servidor Discord:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Problemas comuns

Aqui estão alguns problemas comuns e como resolvê-los.

---

### O opencode não inicia

1. Verifique os logs em busca de mensagens de erro
2. Tente executar com `--print-logs` para ver a saída no terminal
3. Certifique-se de que você tem a versão mais recente com `opencode upgrade`

---

### Problemas de autenticação

1. Tente reautenticar com o comando `/connect` na TUI
2. Verifique se suas chaves de API são válidas
3. Certifique-se de que sua rede permite conexões com a API do provedor

---

### Modelo não disponível

1. Verifique se você se autenticou com o provedor
2. Verifique se o nome do modelo em sua configuração está correto
3. Alguns modelos podem exigir acesso ou assinaturas específicas

Se você encontrar `ProviderModelNotFoundError`, é mais provável que você esteja referenciando um modelo incorretamente em algum lugar.
Os modelos devem ser referenciados assim: `<providerId>/<modelId>`

Exemplos:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Para descobrir quais modelos você tem acesso, execute `opencode models`

---

### ProviderInitError

Se você encontrar um ProviderInitError, provavelmente você tem uma configuração inválida ou corrompida.

Para resolver isso:

1. Primeiro, verifique se seu provedor está configurado corretamente seguindo o [guia de provedores](/docs/providers)
2. Se o problema persistir, tente limpar sua configuração armazenada:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   No Windows, pressione `WIN+R` e exclua: `%USERPROFILE%\.local\share\opencode`

3. Reautentique-se com seu provedor usando o comando `/connect` na TUI.

---

### AI_APICallError e problemas com pacotes de provedores

Se você encontrar erros de chamada de API, isso pode ser devido a pacotes de provedores desatualizados. O opencode instala dinamicamente pacotes de provedores (OpenAI, Anthropic, Google, etc.) conforme necessário e os armazena em cache localmente.

Para resolver problemas com pacotes de provedores:

1. Limpe o cache do pacote de provedores:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   No Windows, pressione `WIN+R` e exclua: `%USERPROFILE%\.cache\opencode`

2. Reinicie o opencode para reinstalar os pacotes de provedores mais recentes

Isso forçará o opencode a baixar as versões mais recentes dos pacotes de provedores, o que muitas vezes resolve problemas de compatibilidade com parâmetros de modelo e alterações na API.

---

### Copiar/colar não funciona no Linux

Usuários do Linux precisam ter um dos seguintes utilitários de área de transferência instalados para que a funcionalidade de copiar/colar funcione:

**Para sistemas X11:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Para sistemas Wayland:**

```bash
apt install -y wl-clipboard
```

**Para ambientes sem cabeça:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

O opencode detectará se você está usando Wayland e preferirá `wl-clipboard`, caso contrário, tentará encontrar ferramentas de área de transferência na ordem: `xclip` e `xsel`.
