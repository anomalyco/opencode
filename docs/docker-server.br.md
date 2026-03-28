# Documentação do Docker do Servidor OpenCode

Este guia cobre a execução do OpenCode em modo servidor dentro de containers Docker.

## Introdução

O Servidor OpenCode é uma implantação headless do OpenCode que executa como um serviço em segundo plano, acessível via API HTTP. A imagem Docker fornece um ambiente de execução completo com todas as ferramentas necessárias pré-instaladas, tornando-o ideal para:

- Ambientes de desenvolvimento remoto
- Integração com CI/CD
- Instâncias de codificação compartilhadas para equipes
- Executar OpenCode em servidores sem interface gráfica

## Início Rápido

Execute o Servidor OpenCode com uma senha segura:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Acesse o servidor em `http://localhost:3000`.

## Variantes de Imagem

Duas variantes de imagem base estão disponíveis:

| Variante | Imagem Base        | Tamanho | Caso de Uso                             |
| -------- | ------------------ | ------- | --------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB  | Recomendado para a maioria dos usuários |
| `alpine` | Alpine Edge        | ~200MB  | Pegada mínima, download mais rápido     |

### Baixando Variantes Específicas

```bash
# Debian (recomendado)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (mínimo)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Variáveis de Ambiente

| Variável                   | Padrão                        | Descrição                                           |
| -------------------------- | ----------------------------- | --------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (nenhum)                      | **Obrigatório.** Senha para autenticação HTTP Basic |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Nome de usuário para autenticação HTTP Basic        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Diretório de configuração                           |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Diretório de cache                                  |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Diretório de dados                                  |

### Opções do Servidor (Flags de CLI)

O servidor aceita estas opções adicionais ao sobrescrever o comando padrão:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Padrão           | Descrição                            |
| --------------- | ---------------- | ------------------------------------ |
| `--port`        | `0` (aleatório)  | Porta para escutar                   |
| `--hostname`    | `127.0.0.1`      | Hostname para vincular               |
| `--mdns`        | `false`          | Habilitar descoberta de serviço mDNS |
| `--mdns-domain` | `opencode.local` | Nome de domínio mDNS personalizado   |
| `--cors`        | `[]`             | Domínios CORS adicionais permitidos  |

## Montagem de Volumes

Monte estes volumes para persistir dados e compartilhar recursos:

### Workspace (Obrigatório)

```bash
-v /path/to/workspace:/workspace
```

É aqui que o OpenCode opera nos arquivos do seu projeto. Monte seu repositório de código aqui.

### Chaves SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Acesso somente leitura às chaves SSH para clonar repositórios privados.

### Configuração do Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Herdar identidade de usuário Git do host.

### Configuração do OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Persistir configurações do OpenCode entre reinicializações do container.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Armazenar em cache pacotes npm, language servers e outras ferramentas baixadas.

## Portas

| Porta  | Protocolo | Descrição                          |
| ------ | --------- | ---------------------------------- |
| `3000` | HTTP      | API principal do servidor (padrão) |

A porta pode ser remapeada através da flag `-p` do Docker:

```bash
-p 8080:3000  # Acessar servidor em http://localhost:8080
```

## Usuário e Permissões

O container executa como um usuário não-root (`opencode`, UID 1000) por segurança. Este usuário tem acesso `sudo` sem senha para tarefas administrativas:

```bash
# Executar comandos como usuário opencode
docker exec -it opencode-server sudo -u opencode <command>

# Obter shell como usuário opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Se você precisar de acesso root:

```bash
docker exec -it opencode-server /bin/bash
```

## Ferramentas Instaladas

A imagem inclui estas ferramentas pronto para uso:

| Ferramenta        | Descrição                                              |
| ----------------- | ------------------------------------------------------ |
| `opencode`        | CLI do OpenCode                                        |
| `bun`             | Runtime JavaScript e gerenciador de pacotes            |
| `bunx`            | Equivalente do Bun ao npx (executar pacotes npm)       |
| `uv`              | Gerenciador de pacotes Python                          |
| `git`             | Controle de versão                                     |
| `git-lfs`         | Extensão de armazenamento de arquivos grandes para Git |
| `build-essential` | GCC, make e bibliotecas de compilação                  |
| `curl`            | Cliente HTTP                                           |
| `wget`            | Utilitário de download de arquivos                     |
| `openssh-client`  | Cliente SSH e ferramentas de chave                     |
| `xz-utils`        | Utilitários de compressão                              |

### Usando bun

```bash
# Executar um pacote Node.js
docker exec -it opencode-server bunx create-next-app

# Instalar dependências
docker exec -it opencode-server bun install
```

### Usando uv

```bash
# Instalar um pacote Python
docker exec -it opencode-server uv pip install pandas

# Executar um script Python
docker exec -it opencode-server uv run script.py
```

### Usando git

```bash
# Clonar um repositório para o workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Verificação de Saúde

O container inclui uma verificação de saúde integrada que verifica se o servidor está respondendo:

```bash
# Verificar saúde do container
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

O endpoint de saúde retorna HTTP 200 quando está saudável:

```bash
# Verificação de saúde manual
curl -f http://localhost:3000/health
```

Configuração da verificação de saúde:

- Intervalo: 30 segundos
- Timeout: 10 segundos
- Período de início: 10 segundos
- Tentativas: 3

## Exemplo de Docker Compose

Crie um arquivo `docker-compose.yml`:

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

Inicie o stack:

```bash
docker-compose up -d
```

## Construindo a Partir do Código-Fonte

Para construir a imagem do servidor a partir do código-fonte:

### Clonar o repositório

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Construir variante Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Construir variante Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Executar sua construção local

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Solução de Problemas

### Servidor não inicia

Verifique os logs:

```bash
docker logs opencode-server
```

Problemas comuns:

- Falta `OPENCODE_SERVER_PASSWORD` - o servidor se recusa a iniciar sem autenticação
- Porta já em uso - altere o mapeamento da porta do host

### Autenticação falhando

Certifique-se de que a senha corresponde exatamente. O servidor usa HTTP Basic Auth:

```bash
# Testar autenticação
curl -u opencode:your_password http://localhost:3000/health
```

### Erros de permissão do workspace

Certifique-se de que o diretório montado é gravável pelo UID 1000:

```bash
# Corrigir propriedade
sudo chown -R 1000:1000 /path/to/workspace
```

### Inicialização lenta

O primeiro download baixa language servers e ferramentas. Verifique o progresso:

```bash
docker logs -f opencode-server
```

### Container não consegue acessar a internet

Verifique a configuração de DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Verificação de saúde falhando

Verifique se o servidor está realmente em execução:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### Chave SSH não funcionando

Certifique-se de que as permissões da chave estão corretas dentro do container:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
