# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart для розгортання сервера OpenCode AI Assistant на Kubernetes.

## Опис

Цей Helm chart встановлює сервер OpenCode AI Assistant у кластері Kubernetes. OpenCode — це асистент штучного інтелекту для розробки програмного забезпечення, який можна інтегрувати з редакторами коду через Language Server Protocol (LSP).

## Передумови

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx або traefik)

## Встановлення

### Додати репозиторій

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Базове встановлення

```bash
helm install opencode opencode/opencode
```

### Встановлення з користувацькими значеннями

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Встановлення з values файлом

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Конфігурація

Дивіться файл `values.yaml` для всіх налаштовуваних параметрів.

### Основні параметри

| Параметр             | Опис                  | Значення за замовчуванням    |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker образ          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Тег образу            | `dev-alpine`                 |
| `replicaCount`       | Кількість реплік      | `1`                          |
| `service.type`       | Тип сервісу           | `ClusterIP`                  |
| `service.port`       | Порт сервісу          | `80`                         |
| `service.targetPort` | Порт контейнера       | `4096`                       |
| `server.port`        | Порт сервера opencode | `4096`                       |

### Аутентифікація

| Параметр              | Опис                     | Значення за замовчуванням |
| --------------------- | ------------------------ | ------------------------- |
| `auth.enabled`        | Увімкнути аутентифікацію | `false`                   |
| `auth.username`       | Ім'я користувача         | `opencode`                |
| `auth.password`       | Пароль                   | `""`                      |
| `auth.existingSecret` | Існуючий secret          | `""`                      |

### Session Affinity

| Параметр              | Опис                        | Значення за замовчуванням |
| --------------------- | --------------------------- | ------------------------- |
| `affinity.enabled`    | Увімкнути sticky sessions   | `true`                    |
| `affinity.cookieName` | Назва кукі                  | `OPENCODEAFFINITY`        |
| `affinity.mode`       | Режим (balanced/persistent) | `balanced`                |
| `affinity.type`       | Тип (cookie)                | `cookie`                  |

### Персистентність

| Параметр                        | Опис            | Значення за замовчуванням |
| ------------------------------- | --------------- | ------------------------- |
| `persistence.data.enabled`      | PVC для даних   | `false`                   |
| `persistence.data.storageClass` | StorageClass    | `""`                      |
| `persistence.data.accessMode`   | Режим доступу   | `ReadWriteOnce`           |
| `persistence.data.size`         | Розмір          | `1Gi`                     |
| `persistence.cache.enabled`     | PVC для кешу    | `false`                   |
| `persistence.config.enabled`    | PVC для конфігу | `false`                   |

### ConfigMaps

| Параметр                     | Опис                   | Значення за замовчуванням |
| ---------------------------- | ---------------------- | ------------------------- |
| `configMaps.agents.enabled`  | Монтувати AGENTS.md    | `false`                   |
| `configMaps.agents.data`     | Вміст ConfigMap        | `{}`                      |
| `configMaps.docs.enabled`    | Монтувати документацію | `false`                   |
| `configMaps.docs.data`       | Вміст ConfigMap        | `{}`                      |
| `configMaps.plugins.enabled` | Монтувати плагіни      | `false`                   |
| `configMaps.plugins.data`    | Вміст ConfigMap        | `{}`                      |

### Ресурси

| Параметр                    | Опис           | Значення за замовчуванням |
| --------------------------- | -------------- | ------------------------- |
| `resources.requests.cpu`    | CPU request    | `100m`                    |
| `resources.requests.memory` | Memory request | `128Mi`                   |
| `resources.limits.cpu`      | CPU limit      | `2000m`                   |
| `resources.limits.memory`   | Memory limit   | `2Gi`                     |

## Приклади конфігурації

### Базовий приклад

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Приклад з аутентифікацією

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Приклад з персистентністю

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

### Приклад з вимкненою session affinity

```yaml
affinity:
  enabled: false
```

### Повний приклад з Ingress

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

OpenCode вимагає sticky sessions (session affinity) для коректної роботи за наявності кількох реплік. Це необхідно, оскільки сервер зберігає стан з'єднання з клієнтом.

### Nginx Ingress

Для Nginx Ingress налаштування sticky sessions відбувається автоматично, якщо `affinity.enabled: true`. Chart автоматично налаштовує необхідні анотації:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # або persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Для Traefik переконайтесь, що налаштовано middleware для sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Режими Affinity

- **balanced**: Запити розподіляються рівноміж між доступними бекендами
- **persistent**: Запити завжди спрямовуються до того самого бекенду, коли це можливо

## Томи

Chart монтує наступні томи:

| Path                          | Опис                    |
| ----------------------------- | ----------------------- |
| `/root/.config/opencode`      | Директорія конфігурації |
| `/root/.cache/opencode`       | Кеш opencode            |
| `/root/.local/share/opencode` | Дані opencode           |

## Змінні середовища

Наступні змінні середовища можна налаштувати через `env`:

| Змінна                  | Опис                    | Значення за замовчуванням |
| ----------------------- | ----------------------- | ------------------------- |
| `PORT`                  | Порт сервера            | `4096`                    |
| `OPENCODE_CONFIG_DIR`   | Директорія конфігурації | `/root/.config/opencode`  |
| `OPENCODE_MDNS_DOMAIN`  | Домен mDNS              | `local`                   |
| `OPENCODE_MDNS_ENABLED` | Увімкнути mDNS          | `false`                   |

Приклад налаштування змінних середовища:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Додаткові функції

### Autoscaling

HPA (Horizontal Pod Autoscaler) можна увімкнути:

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

### Додаткові томи

Для монтування додаткових томів:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Підтримка автоматичного TLS з cert-manager
- [ ] Приклади конфігурації для хмарних провайдерів
- [ ] Інтеграція з Prometheus/Grafana для метрик
- [ ] Шаблони для деплою з PostgreSQL
- [ ] Підтримка Helm тестів

## Внесок

Внески вітаються! Будь ласка, надішліть PR або відкрийте issue на [GitHub](https://github.com/anomalyco/opencode).

## Ліцензія

Apache License 2.0 — див. [LICENSE](LICENSE) для деталей.
