# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart til implementering af OpenCode AI-assistent server på Kubernetes.

## Beskrivelse

Dette Helm chart installerer OpenCode AI Assistant serveren i en Kubernetes cluster. OpenCode er en AI-assistent til softwareudvikling, der kan integreres med kodeeditorer via Language Server Protocol (LSP).

## Forudsætninger

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx eller traefik)

## Installation

### Tilføj repository

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Basis installation

```bash
helm install opencode opencode/opencode
```

### Installation med tilpassede værdier

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Installation med values fil

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Konfiguration

Se `values.yaml` filen for alle konfigurerbare parametre.

### Hovedparametre

| Parameter            | Beskrivelse          | Standardværdi                |
| -------------------- | -------------------- | ---------------------------- |
| `image.repository`   | Docker image         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image tag            | `dev-alpine`                 |
| `replicaCount`       | Antal replicas       | `1`                          |
| `service.type`       | Service type         | `ClusterIP`                  |
| `service.port`       | Service port         | `80`                         |
| `service.targetPort` | Container port       | `4096`                       |
| `server.port`        | Opencode server port | `4096`                       |

### Autentifikation

| Parameter             | Beskrivelse             | Standardværdi |
| --------------------- | ----------------------- | ------------- |
| `auth.enabled`        | Aktiver autentifikation | `false`       |
| `auth.username`       | Brugernavn              | `opencode`    |
| `auth.password`       | Adgangskode             | `""`          |
| `auth.existingSecret` | Eksisterende secret     | `""`          |

### Session Affinity

| Parameter             | Beskrivelse                    | Standardværdi      |
| --------------------- | ------------------------------ | ------------------ |
| `affinity.enabled`    | Aktiver sticky sessions        | `true`             |
| `affinity.cookieName` | Cookie navn                    | `OPENCODEAFFINITY` |
| `affinity.mode`       | Tilstand (balanced/persistent) | `balanced`         |
| `affinity.type`       | Type (cookie)                  | `cookie`           |

### Persistence

| Parameter                       | Beskrivelse     | Standardværdi   |
| ------------------------------- | --------------- | --------------- |
| `persistence.data.enabled`      | PVC for data    | `false`         |
| `persistence.data.storageClass` | StorageClass    | `""`            |
| `persistence.data.accessMode`   | Adgangstilstand | `ReadWriteOnce` |
| `persistence.data.size`         | Størrelse       | `1Gi`           |
| `persistence.cache.enabled`     | PVC for cache   | `false`         |
| `persistence.config.enabled`    | PVC for config  | `false`         |

### ConfigMaps

| Parameter                    | Beskrivelse          | Standardværdi |
| ---------------------------- | -------------------- | ------------- |
| `configMaps.agents.enabled`  | Montér AGENTS.md     | `false`       |
| `configMaps.agents.data`     | ConfigMap indhold    | `{}`          |
| `configMaps.docs.enabled`    | Montér dokumentation | `false`       |
| `configMaps.docs.data`       | ConfigMap indhold    | `{}`          |
| `configMaps.plugins.enabled` | Montér plugins       | `false`       |
| `configMaps.plugins.data`    | ConfigMap indhold    | `{}`          |

### Ressourcer

| Parameter                   | Beskrivelse    | Standardværdi |
| --------------------------- | -------------- | ------------- |
| `resources.requests.cpu`    | CPU request    | `100m`        |
| `resources.requests.memory` | Memory request | `128Mi`       |
| `resources.limits.cpu`      | CPU limit      | `2000m`       |
| `resources.limits.memory`   | Memory limit   | `2Gi`         |

## Konfigurationseksempler

### Basis eksempel

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Eksempel med autentifikation

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Eksempel med persistence

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

### Eksempel med session affinity deaktiveret

```yaml
affinity:
  enabled: false
```

### Komplet eksempel med Ingress

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

OpenCode kræver sticky sessions (session affinity) for at fungere korrekt, når der er flere replicas. Dette er nødvendigt, fordi serveren holder tilstand af forbindelsen til klienten.

### Nginx Ingress

For Nginx Ingress konfigureres sticky sessions automatisk, når `affinity.enabled: true`. Charten konfigurerer automatisk de nødvendige annotations:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # eller persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

For Traefik skal du sørge for at konfigurere sticky sessions middleware:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity tilstande

- **balanced**: Anmodninger fordeles lige mellem tilgængelige backends
- **persistent**: Anmodninger sendes altid til den samme backend, når det er muligt

## Volumes

Charten monterer følgende volumes:

| Path                          | Beskrivelse         |
| ----------------------------- | ------------------- |
| `/root/.config/opencode`      | Konfigurationsmappe |
| `/root/.cache/opencode`       | Opencode cache      |
| `/root/.local/share/opencode` | Opencode data       |

## Miljøvariabler

Følgende miljøvariabler kan konfigureres via `env`:

| Variável                | Beskrivelse         | Standardværdi            |
| ----------------------- | ------------------- | ------------------------ |
| `PORT`                  | Server port         | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Konfigurationsmappe | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS domæne         | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Aktiver mDNS        | `false`                  |

Eksempel på miljøvariabel konfiguration:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Yderligere Ressourcer

### Autoscaling

HPA (Horizontal Pod Autoscaler) kan aktiveres:

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

### Ekstra Volumes

For at montere ekstra volumes:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Support til automatisk TLS med cert-manager
- [ ] Konfigurationseksempler for cloud udbydere
- [ ] Integration med Prometheus/Grafana til metrics
- [ ] Skabeloner til deployment med PostgreSQL
- [ ] Support til Helm tests

## Bidrag

Bidrag er velkomne! Send venligst en PR eller åbn en issue på [GitHub](https://github.com/anomalyco/opencode).

## Licens

Apache License 2.0 - se [LICENSE](LICENSE) for detaljer.
