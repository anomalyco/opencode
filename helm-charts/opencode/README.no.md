# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart for deploying OpenCode AI assistant server on Kubernetes.

## Beskrivelse

Denne Helm-charten installerer OpenCode AI Assistant-serveren i en Kubernetes-klynge. OpenCode er en KI-assistent for programvareutvikling som kan integreres med kodeeditorer via Language Server Protocol (LSP).

## Forutsetninger

- Kubernetes 1.19+
- Helm 3+
- Ingress-kontroller (nginx eller traefik)

## Installasjon

### Legge til repository

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Grunnleggende installasjon

```bash
helm install opencode opencode/opencode
```

### Installasjon med egendefinerte verdier

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Installasjon med values-fil

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Konfigurasjon

Se `values.yaml`-filen for alle konfigurerbare parametere.

### Hovedparametere

| Parameter            | Beskrivelse          | Standardverdi                |
| -------------------- | -------------------- | ---------------------------- |
| `image.repository`   | Docker-image         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image-tag            | `dev-alpine`                 |
| `replicaCount`       | Antall replikaer     | `1`                          |
| `service.type`       | Service-type         | `ClusterIP`                  |
| `service.port`       | Service-port         | `80`                         |
| `service.targetPort` | Container-port       | `4096`                       |
| `server.port`        | Opencode server-port | `4096`                       |

### Autentisering

| Parameter             | Beskrivelse           | Standardverdi |
| --------------------- | --------------------- | ------------- |
| `auth.enabled`        | Aktiver autentisering | `false`       |
| `auth.username`       | Brukernavn            | `opencode`    |
| `auth.password`       | Passord               | `""`          |
| `auth.existingSecret` | Eksisterende secret   | `""`          |

### Session Affinity

| Parameter             | Beskrivelse                 | Standardverdi      |
| --------------------- | --------------------------- | ------------------ |
| `affinity.enabled`    | Aktiver sticky sessions     | `true`             |
| `affinity.cookieName` | Cookienavn                  | `OPENCODEAFFINITY` |
| `affinity.mode`       | Modus (balanced/persistent) | `balanced`         |
| `affinity.type`       | Type (cookie)               | `cookie`           |

### Persistence

| Parameter                       | Beskrivelse    | Standardverdi   |
| ------------------------------- | -------------- | --------------- |
| `persistence.data.enabled`      | PVC for data   | `false`         |
| `persistence.data.storageClass` | StorageClass   | `""`            |
| `persistence.data.accessMode`   | Tilgangsmodus  | `ReadWriteOnce` |
| `persistence.data.size`         | Størrelse      | `1Gi`           |
| `persistence.cache.enabled`     | PVC for cache  | `false`         |
| `persistence.config.enabled`    | PVC for config | `false`         |

### ConfigMaps

| Parameter                    | Beskrivelse           | Standardverdi |
| ---------------------------- | --------------------- | ------------- |
| `configMaps.agents.enabled`  | Montere AGENTS.md     | `false`       |
| `configMaps.agents.data`     | ConfigMap-innhold     | `{}`          |
| `configMaps.docs.enabled`    | Montere dokumentasjon | `false`       |
| `configMaps.docs.data`       | ConfigMap-innhold     | `{}`          |
| `configMaps.plugins.enabled` | Montere plugins       | `false`       |
| `configMaps.plugins.data`    | ConfigMap-innhold     | `{}`          |

### Ressurser

| Parameter                   | Beskrivelse       | Standardverdi |
| --------------------------- | ----------------- | ------------- |
| `resources.requests.cpu`    | CPU-forespørsel   | `100m`        |
| `resources.requests.memory` | Minne-forespørsel | `128Mi`       |
| `resources.limits.cpu`      | CPU-grense        | `2000m`       |
| `resources.limits.memory`   | Minne-grense      | `2Gi`         |

## Konfigurasjonseksempler

### Grunnleggende eksempel

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Eksempel med autentisering

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

### Eksempel med session affinity deaktivert

```yaml
affinity:
  enabled: false
```

### Komplett eksempel med Ingress

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

OpenCode krever sticky sessions (session affinity) for å fungere korrekt når det er flere replikaer. Dette er nødvendig fordi serveren vedlikeholder tilstand for tilkoblingen til klienten.

### Nginx Ingress

For Nginx Ingress konfigureres sticky sessions automatisk når `affinity.enabled: true`. Charten konfigurerer automatisk de nødvendige annotasjonene:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # eller persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

For Traefik, sørg for å konfigurere sticky sessions-middleware:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity-moduser

- **balanced**: Forespørsler fordeles jevnt mellom tilgjengelige backends
- **persistent**: Forespørsler sendes alltid til samme backend når det er mulig

## Volumer

Charten monterer følgende volumer:

| Path                          | Beskrivelse           |
| ----------------------------- | --------------------- |
| `/root/.config/opencode`      | Konfigurasjonskatalog |
| `/root/.cache/opencode`       | Opencode cache        |
| `/root/.local/share/opencode` | Opencode data         |

## Miljøvariabler

Følgende miljøvariabler kan konfigureres via `env`:

| Variabel                | Beskrivelse           | Standardverdi            |
| ----------------------- | --------------------- | ------------------------ |
| `PORT`                  | Serverport            | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Konfigurasjonskatalog | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS-domene           | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Aktiver mDNS          | `false`                  |

Eksempel på miljøvariabelkonfigurasjon:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Tilleggsressurser

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

### Ekstra volumer

For å montere ekstra volumer:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Veikart

- [ ] Støtte for automatisk TLS med cert-manager
- [ ] Konfigurasjonseksempler for sky-leverandører
- [ ] Integrasjon med Prometheus/Grafana for metrikker
- [ ] Maler for distribusjon med PostgreSQL
- [ ] Støtte for Helm-tester

## Bidrag

Bidrag er velkomne! Vennligst send en PR eller åpne en issue på [GitHub](https://github.com/anomalyco/opencode).

## Lisens

Apache License 2.0 - se [LICENSE](LICENSE) for detaljer.
