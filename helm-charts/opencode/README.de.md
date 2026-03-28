# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm Chart für die Bereitstellung des OpenCode AI Assistant Servers auf Kubernetes.

## Beschreibung

Dieses Helm Chart installiert den OpenCode AI Assistant Server in einem Kubernetes Cluster. OpenCode ist ein KI-Assistent für die Softwareentwicklung, der über das Language Server Protocol (LSP) in Code-Editoren integriert werden kann.

## Voraussetzungen

- Kubernetes 1.19+
- Helm 3+
- Ingress Controller (nginx oder traefik)

## Installation

### Repository hinzufügen

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Basis-Installation

```bash
helm install opencode opencode/opencode
```

### Installation mit benutzerdefinierten Werten

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Installation mit values Datei

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Konfiguration

Siehe die `values.yaml` Datei für alle konfigurierbaren Parameter.

### Hauptparameter

| Parameter            | Beschreibung         | Standardwert                 |
| -------------------- | -------------------- | ---------------------------- |
| `image.repository`   | Docker Image         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image Tag            | `dev-alpine`                 |
| `replicaCount`       | Anzahl der Replikate | `1`                          |
| `service.type`       | Service Typ          | `ClusterIP`                  |
| `service.port`       | Service Port         | `80`                         |
| `service.targetPort` | Container Port       | `4096`                       |
| `server.port`        | Opencode Server Port | `4096`                       |

### Authentifizierung

| Parameter             | Beschreibung                 | Standardwert |
| --------------------- | ---------------------------- | ------------ |
| `auth.enabled`        | Authentifizierung aktivieren | `false`      |
| `auth.username`       | Benutzername                 | `opencode`   |
| `auth.password`       | Passwort                     | `""`         |
| `auth.existingSecret` | Bestehendes Secret           | `""`         |

### Session Affinity

| Parameter             | Beschreibung                | Standardwert       |
| --------------------- | --------------------------- | ------------------ |
| `affinity.enabled`    | Sticky Sessions aktivieren  | `true`             |
| `affinity.cookieName` | Cookie Name                 | `OPENCODEAFFINITY` |
| `affinity.mode`       | Modus (balanced/persistent) | `balanced`         |
| `affinity.type`       | Typ (cookie)                | `cookie`           |

### Persistence

| Parameter                       | Beschreibung   | Standardwert    |
| ------------------------------- | -------------- | --------------- |
| `persistence.data.enabled`      | PVC für Daten  | `false`         |
| `persistence.data.storageClass` | StorageClass   | `""`            |
| `persistence.data.accessMode`   | Zugriffsmodus  | `ReadWriteOnce` |
| `persistence.data.size`         | Größe          | `1Gi`           |
| `persistence.cache.enabled`     | PVC für Cache  | `false`         |
| `persistence.config.enabled`    | PVC für Config | `false`         |

### ConfigMaps

| Parameter                    | Beschreibung            | Standardwert |
| ---------------------------- | ----------------------- | ------------ |
| `configMaps.agents.enabled`  | AGENTS.md einhängen     | `false`      |
| `configMaps.agents.data`     | ConfigMap Inhalt        | `{}`         |
| `configMaps.docs.enabled`    | Dokumentation einhängen | `false`      |
| `configMaps.docs.data`       | ConfigMap Inhalt        | `{}`         |
| `configMaps.plugins.enabled` | Plugins einhängen       | `false`      |
| `configMaps.plugins.data`    | ConfigMap Inhalt        | `{}`         |

### Ressourcen

| Parameter                   | Beschreibung   | Standardwert |
| --------------------------- | -------------- | ------------ |
| `resources.requests.cpu`    | CPU Anfrage    | `100m`       |
| `resources.requests.memory` | Memory Anfrage | `128Mi`      |
| `resources.limits.cpu`      | CPU Limit      | `2000m`      |
| `resources.limits.memory`   | Memory Limit   | `2Gi`        |

## Konfigurationsbeispiele

### Basis-Beispiel

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Beispiel mit Authentifizierung

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Beispiel mit Persistence

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

### Beispiel mit deaktivierter Session Affinity

```yaml
affinity:
  enabled: false
```

### Vollständiges Beispiel mit Ingress

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

OpenCode erfordert sticky sessions (Session Affinity) für den ordnungsgemäßen Betrieb bei mehreren Replikaten. Dies ist erforderlich, weil der Server den Zustand der Verbindung zum Client beibehält.

### Nginx Ingress

Für Nginx Ingress wird die sticky sessions Konfiguration automatisch bei `affinity.enabled: true` eingerichtet. Das Chart konfiguriert automatisch die erforderlichen Annotations:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # oder persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Für Traefik stellen Sie sicher, dass Sie das sticky sessions Middleware konfigurieren:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity Modi

- **balanced**: Anfragen werden gleichmäßig auf die verfügbaren Backends verteilt
- **persistent**: Anfragen werden nach Möglichkeit immer an dasselbe Backend geleitet

## Volumes

Das Chart hängt die folgenden Volumes ein:

| Path                          | Beschreibung              |
| ----------------------------- | ------------------------- |
| `/root/.config/opencode`      | Konfigurationsverzeichnis |
| `/root/.cache/opencode`       | Opencode Cache            |
| `/root/.local/share/opencode` | Opencode Daten            |

## Umgebungsvariablen

Die folgenden Umgebungsvariablen können über `env` konfiguriert werden:

| Variable                | Beschreibung              | Standardwert             |
| ----------------------- | ------------------------- | ------------------------ |
| `PORT`                  | Server Port               | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Konfigurationsverzeichnis | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS Domain               | `local`                  |
| `OPENCODE_MDNS_ENABLED` | mDNS aktivieren           | `false`                  |

Beispiel für die Konfiguration von Umgebungsvariablen:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Zusätzliche Funktionen

### Autoscaling

Der HPA (Horizontal Pod Autoscaler) kann aktiviert werden:

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

### Extra Volumes

Um zusätzliche Volumes einzuhängen:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Unterstützung für automatisches TLS mit cert-manager
- [ ] Konfigurationsbeispiele für Cloud-Anbieter
- [ ] Integration mit Prometheus/Grafana für Metriken
- [ ] Templates für Deployment mit PostgreSQL
- [ ] Unterstützung für Helm Tests

## Beitrag

Beiträge sind willkommen! Bitte senden Sie eine PR oder erstellen Sie ein Issue auf [GitHub](https://github.com/anomalyco/opencode).

## Lizenz

Apache License 2.0 - see [LICENSE](LICENSE) für Details.
