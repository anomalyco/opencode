# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart for deploying OpenCode AI assistant server on Kubernetes.

## Opis

Ten chart Helm instaluje serwer OpenCode AI Assistant w klastrze Kubernetes. OpenCode to asystent AI do tworzenia oprogramowania, który może być zintegrowany z edytorami kodu za pomocą Language Server Protocol (LSP).

## Wymagania wstępne

- Kubernetes 1.19+
- Helm 3+
- Kontroler Ingress (nginx lub traefik)

## Instalacja

### Dodanie repozytorium

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Podstawowa instalacja

```bash
helm install opencode opencode/opencode
```

### Instalacja z niestandardowymi wartościami

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Instalacja z plikiem values

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Konfiguracja

Zobacz plik `values.yaml` aby zobaczyć wszystkie konfigurowalne parametry.

### Główne parametry

| Parametr             | Opis                  | Wartość domyślna             |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Obraz Docker          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag obrazu            | `dev-alpine`                 |
| `replicaCount`       | Liczba replik         | `1`                          |
| `service.type`       | Typ serwisu           | `ClusterIP`                  |
| `service.port`       | Port serwisu          | `80`                         |
| `service.targetPort` | Port kontenera        | `4096`                       |
| `server.port`        | Port serwera opencode | `4096`                       |

### Autoryzacja

| Parametr              | Opis              | Wartość domyślna |
| --------------------- | ----------------- | ---------------- |
| `auth.enabled`        | Włącz autoryzację | `false`          |
| `auth.username`       | Nazwa użytkownika | `opencode`       |
| `auth.password`       | Hasło             | `""`             |
| `auth.existingSecret` | Istniejący sekret | `""`             |

### Session Affinity

| Parametr              | Opis                       | Wartość domyślna   |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | Włącz sticky sessions      | `true`             |
| `affinity.cookieName` | Nazwa ciasteczka           | `OPENCODEAFFINITY` |
| `affinity.mode`       | Tryb (balanced/persistent) | `balanced`         |
| `affinity.type`       | Typ (cookie)               | `cookie`           |

### Persistence

| Parametr                        | Opis           | Wartość domyślna |
| ------------------------------- | -------------- | ---------------- |
| `persistence.data.enabled`      | PVC dla danych | `false`          |
| `persistence.data.storageClass` | StorageClass   | `""`             |
| `persistence.data.accessMode`   | Tryb dostępu   | `ReadWriteOnce`  |
| `persistence.data.size`         | Rozmiar        | `1Gi`            |
| `persistence.cache.enabled`     | PVC dla cache  | `false`          |
| `persistence.config.enabled`    | PVC dla config | `false`          |

### ConfigMaps

| Parametr                     | Opis                | Wartość domyślna |
| ---------------------------- | ------------------- | ---------------- |
| `configMaps.agents.enabled`  | Montuj AGENTS.md    | `false`          |
| `configMaps.agents.data`     | Zawartość ConfigMap | `{}`             |
| `configMaps.docs.enabled`    | Montuj dokumentację | `false`          |
| `configMaps.docs.data`       | Zawartość ConfigMap | `{}`             |
| `configMaps.plugins.enabled` | Montuj wtyczki      | `false`          |
| `configMaps.plugins.data`    | Zawartość ConfigMap | `{}`             |

### Zasoby

| Parametr                    | Opis            | Wartość domyślna |
| --------------------------- | --------------- | ---------------- |
| `resources.requests.cpu`    | Żądanie CPU     | `100m`           |
| `resources.requests.memory` | Żądanie pamięci | `128Mi`          |
| `resources.limits.cpu`      | Limit CPU       | `2000m`          |
| `resources.limits.memory`   | Limit pamięci   | `2Gi`            |

## Przykłady konfiguracji

### Podstawowy przykład

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Przykład z autoryzacją

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Przykład z persistence

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

### Przykład z wyłączonym session affinity

```yaml
affinity:
  enabled: false
```

### Pełny przykład z Ingress

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

OpenCode wymaga sticky sessions (session affinity) do poprawnego działania, gdy jest wiele replik. Jest to konieczne, ponieważ serwer utrzymuje stan połączenia z klientem.

### Nginx Ingress

Dla Nginx Ingress, konfiguracja sticky sessions jest automatyczna gdy `affinity.enabled: true`. Chart automatycznie konfiguruje wymagane adnotacje:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # lub persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Dla Traefik, upewnij się, że skonfigurowałeś middleware sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Tryby Affinity

- **balanced**: Żądania są dystrybuowane równo między dostępne backends
- **persistent**: Żądania są zawsze kierowane do tego samego backendu, gdy jest to możliwe

## Wolumeny

Chart montuje następujące wolumeny:

| Path                          | Opis                 |
| ----------------------------- | -------------------- |
| `/root/.config/opencode`      | Katalog konfiguracji |
| `/root/.cache/opencode`       | Cache opencode       |
| `/root/.local/share/opencode` | Dane opencode        |

## Zmienne środowiskowe

Następujące zmienne środowiskowe mogą być skonfigurowane przez `env`:

| Zmienna                 | Opis                 | Wartość domyślna         |
| ----------------------- | -------------------- | ------------------------ |
| `PORT`                  | Port serwera         | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Katalog konfiguracji | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Domen mDNS           | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Włącz mDNS           | `false`                  |

Przykład konfiguracji zmiennych środowiskowych:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Dodatkowe funkcje

### Autoscaling

HPA (Horizontal Pod Autoscaler) może być włączony:

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

### Dodatkowe wolumeny

Aby zamontować dodatkowe wolumeny:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Wsparcie dla automatycznego TLS z cert-manager
- [ ] Przykłady konfiguracji dla dostawców chmury
- [ ] Integracja z Prometheus/Grafana dla metryk
- [ ] Szablony dla deployment z PostgreSQL
- [ ] Wsparcie dla testów Helm

## Wkład

Wkład jest mile widziany! Proszę wysłać PR lub otworzyć issue na [GitHub](https://github.com/anomalyco/opencode).

## Licencja

Apache License 2.0 - zobacz [LICENSE](LICENSE) dla szczegółów.
