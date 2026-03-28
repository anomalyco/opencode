# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart для развёртывания сервера OpenCode AI Assistant в Kubernetes.

## Описание

Этот Helm chart устанавливает сервер OpenCode AI Assistant в кластере Kubernetes. OpenCode — это ИИ-ассистент для разработки программного обеспечения, который может быть интегрирован с редакторами кода через Language Server Protocol (LSP).

## Предварительные требования

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx или traefik)

## Установка

### Добавление репозитория

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Базовая установка

```bash
helm install opencode opencode/opencode
```

### Установка с пользовательскими значениями

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Установка с values файлом

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Конфигурация

Смотрите файл `values.yaml` для всех настраиваемых параметров.

### Основные параметры

| Параметр             | Описание              | Значение по умолчанию        |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker образ          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Тег образа            | `dev-alpine`                 |
| `replicaCount`       | Количество реплик     | `1`                          |
| `service.type`       | Тип сервиса           | `ClusterIP`                  |
| `service.port`       | Порт сервиса          | `80`                         |
| `service.targetPort` | Порт контейнера       | `4096`                       |
| `server.port`        | Порт сервера opencode | `4096`                       |

### Аутентификация

| Параметр              | Описание                | Значение по умолчанию |
| --------------------- | ----------------------- | --------------------- |
| `auth.enabled`        | Включить аутентификацию | `false`               |
| `auth.username`       | Имя пользователя        | `opencode`            |
| `auth.password`       | Пароль                  | `""`                  |
| `auth.existingSecret` | Существующий Secret     | `""`                  |

### Session Affinity

| Параметр              | Описание                    | Значение по умолчанию |
| --------------------- | --------------------------- | --------------------- |
| `affinity.enabled`    | Включить sticky sessions    | `true`                |
| `affinity.cookieName` | Имя куки                    | `OPENCODEAFFINITY`    |
| `affinity.mode`       | Режим (balanced/persistent) | `balanced`            |
| `affinity.type`       | Тип (cookie)                | `cookie`              |

### Персистентность

| Параметр                        | Описание        | Значение по умолчанию |
| ------------------------------- | --------------- | --------------------- |
| `persistence.data.enabled`      | PVC для данных  | `false`               |
| `persistence.data.storageClass` | StorageClass    | `""`                  |
| `persistence.data.accessMode`   | Режим доступа   | `ReadWriteOnce`       |
| `persistence.data.size`         | Размер          | `1Gi`                 |
| `persistence.cache.enabled`     | PVC для кэша    | `false`               |
| `persistence.config.enabled`    | PVC для конфига | `false`               |

### ConfigMaps

| Параметр                     | Описание                 | Значение по умолчанию |
| ---------------------------- | ------------------------ | --------------------- |
| `configMaps.agents.enabled`  | Монтировать AGENTS.md    | `false`               |
| `configMaps.agents.data`     | Содержимое ConfigMap     | `{}`                  |
| `configMaps.docs.enabled`    | Монтировать документацию | `false`               |
| `configMaps.docs.data`       | Содержимое ConfigMap     | `{}`                  |
| `configMaps.plugins.enabled` | Монтировать плагины      | `false`               |
| `configMaps.plugins.data`    | Содержимое ConfigMap     | `{}`                  |

### Ресурсы

| Параметр                    | Описание      | Значение по умолчанию |
| --------------------------- | ------------- | --------------------- |
| `resources.requests.cpu`    | Запрос CPU    | `100m`                |
| `resources.requests.memory` | Запрос памяти | `128Mi`               |
| `resources.limits.cpu`      | Лимит CPU     | `2000m`               |
| `resources.limits.memory`   | Лимит памяти  | `2Gi`                 |

## Примеры конфигурации

### Базовый пример

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Пример с аутентификацией

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Пример с персистентностью

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

### Пример с отключённым session affinity

```yaml
affinity:
  enabled: false
```

### Полный пример с Ingress

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

## Session Affinity

OpenCode требует sticky sessions (session affinity) для корректной работы при наличии нескольких реплик. Это необходимо, потому что сервер поддерживает состояние соединения с клиентом.

### Nginx Ingress

Для Nginx Ingress настройка sticky sessions выполняется автоматически при `affinity.enabled: true`. Chart автоматически настраивает необходимые аннотации:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # или persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Для Traefik убедитесь, что настроен middleware для sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Режимы Affinity

- **balanced**: Запросы распределяются равномерно между доступными бэкендами
- **persistent**: Запросы всегда направляются на один и тот же бэкенд, когда это возможно

## Тома

Chart монтирует следующие тома:

| Path                          | Описание                |
| ----------------------------- | ----------------------- |
| `/root/.config/opencode`      | Директория конфигурации |
| `/root/.cache/opencode`       | Кэш opencode            |
| `/root/.local/share/opencode` | Данные opencode         |

## Переменные окружения

Следующие переменные окружения могут быть настроены через `env`:

| Переменная              | Описание                | Значение по умолчанию    |
| ----------------------- | ----------------------- | ------------------------ |
| `PORT`                  | Порт сервера            | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Директория конфигурации | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Домен mDNS              | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Включить mDNS           | `false`                  |

Пример настройки переменных окружения:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Дополнительные возможности

### Autoscaling

HPA (Horizontal Pod Autoscaler) может быть включён:

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Security Context

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### Дополнительные тома

Для монтирования дополнительных томов:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Поддержка автоматического TLS с cert-manager
- [ ] Примеры конфигурации для облачных провайдеров
- [ ] Интеграция с Prometheus/Grafana для метрик
- [ ] Шаблоны для деплоя с PostgreSQL
- [ ] Поддержка Helm tests

## Вклад

Вклад приветствуется! Пожалуйста, отправьте PR или откройте issue на [GitHub](https://github.com/anomalyco/opencode).

## Лицензия

Apache License 2.0 — см. [LICENSE](LICENSE) для подробностей.
