# Chart Helm do OpenCode

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Chart Helm para implantação do servidor assistente de IA OpenCode em Kubernetes.

## Descrição

Este chart Helm instala o servidor do Assistente de IA OpenCode em um cluster Kubernetes. O OpenCode é um assistente de IA para desenvolvimento de software que pode ser integrado com editores de código por meio do Language Server Protocol (LSP).

## Pré-requisitos

- Kubernetes 1.19+
- Helm 3+
- Controlador de Ingress (nginx ou traefik)

## Instalação

### Adicionar o repositório

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Instalação básica

```bash
helm install opencode opencode/opencode
```

### Instalação com valores customizados

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Instalação com arquivo de valores

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Configuração

Consulte o arquivo `values.yaml` para ver todos os parâmetros configuráveis.

### Parâmetros Principais

| Parâmetro            | Descrição                  | Valor Padrão                 |
| -------------------- | -------------------------- | ---------------------------- |
| `image.repository`   | Imagem Docker              | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag da imagem              | `dev-alpine`                 |
| `replicaCount`       | Número de réplicas         | `1`                          |
| `service.type`       | Tipo do Service            | `ClusterIP`                  |
| `service.port`       | Porta do Service           | `80`                         |
| `service.targetPort` | Porta do container         | `4096`                       |
| `server.port`        | Porta do servidor OpenCode | `4096`                       |

### Autenticação

| Parâmetro             | Descrição              | Valor Padrão |
| --------------------- | ---------------------- | ------------ |
| `auth.enabled`        | Habilitar autenticação | `false`      |
| `auth.username`       | Nome de usuário        | `opencode`   |
| `auth.password`       | Senha                  | `""`         |
| `auth.existingSecret` | Secret existente       | `""`         |

### Afinidade de Sessão

| Parâmetro             | Descrição                      | Valor Padrão       |
| --------------------- | ------------------------------ | ------------------ |
| `affinity.enabled`    | Habilitar sessões persistentes | `true`             |
| `affinity.cookieName` | Nome do cookie                 | `OPENCODEAFFINITY` |
| `affinity.mode`       | Modo (balanced/persistent)     | `balanced`         |
| `affinity.type`       | Tipo (cookie)                  | `cookie`           |

### Persistência

| Parâmetro                       | Descrição             | Valor Padrão    |
| ------------------------------- | --------------------- | --------------- |
| `persistence.data.enabled`      | PVC para dados        | `false`         |
| `persistence.data.storageClass` | StorageClass          | `""`            |
| `persistence.data.accessMode`   | Modo de acesso        | `ReadWriteOnce` |
| `persistence.data.size`         | Tamanho               | `1Gi`           |
| `persistence.cache.enabled`     | PVC para cache        | `false`         |
| `persistence.config.enabled`    | PVC para configuração | `false`         |

### ConfigMaps

| Parâmetro                    | Descrição             | Valor Padrão |
| ---------------------------- | --------------------- | ------------ |
| `configMaps.agents.enabled`  | Montar AGENTS.md      | `false`      |
| `configMaps.agents.data`     | Conteúdo do ConfigMap | `{}`         |
| `configMaps.docs.enabled`    | Montar documentação   | `false`      |
| `configMaps.docs.data`       | Conteúdo do ConfigMap | `{}`         |
| `configMaps.plugins.enabled` | Montar plugins        | `false`      |
| `configMaps.plugins.data`    | Conteúdo do ConfigMap | `{}`         |

### Recursos

| Parâmetro                   | Descrição          | Valor Padrão |
| --------------------------- | ------------------ | ------------ |
| `resources.requests.cpu`    | Request de CPU     | `100m`       |
| `resources.requests.memory` | Request de memória | `128Mi`      |
| `resources.limits.cpu`      | Limite de CPU      | `2000m`      |
| `resources.limits.memory`   | Limite de memória  | `2Gi`        |

## Exemplos de Configuração

### Exemplo básico

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Exemplo com autenticação

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Exemplo com persistência

```yaml
persistence:
  data:
    enabled: true
    storageClass: "standard"
    size: 5Gi
  cache:
    enabled: true
    storageClass: "standard"
    size: 2Gi
```

### Exemplo com afinidade de sessão desabilitada

```yaml
affinity:
  enabled: false
```

### Exemplo completo com Ingress

```yaml
replicaCount: 2

image:
  tag: latest

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: opencode.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: opencode-tls
      hosts:
        - opencode.example.com

auth:
  enabled: true
  username: admin
  password: securepassword

affinity:
  enabled: true
  cookieName: OPENCODEAFFINITY
  mode: balanced

persistence:
  data:
    enabled: true
    size: 5Gi
```

## Afinidade de Sessão

O OpenCode requer sessões persistentes (session affinity) para funcionar corretamente quando há múltiplas réplicas. Isso é necessário porque o servidor mantém o estado da conexão com o cliente.

### Nginx Ingress

Para o Nginx Ingress, a configuração de sessões persistentes é automática quando `affinity.enabled: true`. O chart configura automaticamente as anotações necessárias:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # ou persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Para o Traefik, certifique-se de configurar o middleware de sessões persistentes:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Modos de Affinity

- **balanced**: As solicitações são distribuídas igualmente entre os backends disponíveis
- **persistent**: As solicitações são direcionadas sempre ao mesmo backend quando possível

## Volumes

O chart monta os seguintes volumes:

| Path                          | Descrição                 |
| ----------------------------- | ------------------------- |
| `/root/.config/opencode`      | Diretório de configuração |
| `/root/.cache/opencode`       | Cache do OpenCode         |
| `/root/.local/share/opencode` | Dados do OpenCode         |

## Variáveis de Ambiente

As seguintes variáveis de ambiente podem ser configuradas via `env`:

| Variável                | Descrição                 | Valor Padrão             |
| ----------------------- | ------------------------- | ------------------------ |
| `PORT`                  | Porta do servidor         | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Diretório de configuração | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Domínio mDNS              | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Habilitar mDNS            | `false`                  |

Exemplo de configuração de variáveis de ambiente:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Recursos Adicionais

### Autoscaling

O HPA (Horizontal Pod Autoscaler) pode ser habilitado:

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Contexto de Segurança

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### Volumes Extras

Para montar volumes adicionais:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Suporte a TLS automático com cert-manager
- [ ] Exemplos de configuração para provedores de cloud
- [ ] Integração com Prometheus/Grafana para métricas
- [ ] Templates para deployment com PostgreSQL
- [ ] Suporte a testes de Helm

## Contribuição

Contribuições são bem-vindas! Por favor, envie um PR ou abra uma issue em [GitHub](https://github.com/anomalyco/opencode).

## Licença

Licença Apache 2.0 - veja [LICENSE](LICENSE) para detalhes.
