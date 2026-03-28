# Chart Helm OpenCode

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Chart Helm per il deployment del server AI Assistant OpenCode su Kubernetes.

## Descrizione

Questo chart Helm installa il server AI Assistant OpenCode in un cluster Kubernetes. OpenCode è un assistente AI per lo sviluppo software che può essere integrato con editor di codice tramite Language Server Protocol (LSP).

## Prerequisiti

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx o traefik)

## Installazione

### Aggiungere il repository

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Installazione base

```bash
helm install opencode opencode/opencode
```

### Installazione con valori personalizzati

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Installazione con values file

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Configurazione

Consultare il file `values.yaml` per vedere tutti i parametri configurabili.

### Parametri Principali

| Parametro            | Descrizione               | Valore Predefinito           |
| -------------------- | ------------------------- | ---------------------------- |
| `image.repository`   | Immagine Docker           | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag dell'immagine         | `dev-alpine`                 |
| `replicaCount`       | Numero di repliche        | `1`                          |
| `service.type`       | Tipo di service           | `ClusterIP`                  |
| `service.port`       | Porta del service         | `80`                         |
| `service.targetPort` | Porta del container       | `4096`                       |
| `server.port`        | Porta del server opencode | `4096`                       |

### Autenticazione

| Parametro             | Descrizione              | Valore Predefinito |
| --------------------- | ------------------------ | ------------------ |
| `auth.enabled`        | Abilitare autenticazione | `false`            |
| `auth.username`       | Username                 | `opencode`         |
| `auth.password`       | Password                 | `""`               |
| `auth.existingSecret` | Secret esistente         | `""`               |

### Session Affinity

| Parametro             | Descrizione                | Valore Predefinito |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | Abilitare sticky sessions  | `true`             |
| `affinity.cookieName` | Nome del cookie            | `OPENCODEAFFINITY` |
| `affinity.mode`       | Modo (balanced/persistent) | `balanced`         |
| `affinity.type`       | Tipo (cookie)              | `cookie`           |

### Persistence

| Parametro                       | Descrizione         | Valore Predefinito |
| ------------------------------- | ------------------- | ------------------ |
| `persistence.data.enabled`      | PVC per dati        | `false`            |
| `persistence.data.storageClass` | StorageClass        | `""`               |
| `persistence.data.accessMode`   | Modalità di accesso | `ReadWriteOnce`    |
| `persistence.data.size`         | Dimensione          | `1Gi`              |
| `persistence.cache.enabled`     | PVC per cache       | `false`            |
| `persistence.config.enabled`    | PVC per config      | `false`            |

### ConfigMaps

| Parametro                    | Descrizione             | Valore Predefinito |
| ---------------------------- | ----------------------- | ------------------ |
| `configMaps.agents.enabled`  | Montare AGENTS.md       | `false`            |
| `configMaps.agents.data`     | Contenuto del ConfigMap | `{}`               |
| `configMaps.docs.enabled`    | Montare documentazione  | `false`            |
| `configMaps.docs.data`       | Contenuto del ConfigMap | `{}`               |
| `configMaps.plugins.enabled` | Montare plugins         | `false`            |
| `configMaps.plugins.data`    | Contenuto del ConfigMap | `{}`               |

### Risorse

| Parametro                   | Descrizione      | Valore Predefinito |
| --------------------------- | ---------------- | ------------------ |
| `resources.requests.cpu`    | Richiesta CPU    | `100m`             |
| `resources.requests.memory` | Richiesta Memory | `128Mi`            |
| `resources.limits.cpu`      | Limite CPU       | `2000m`            |
| `resources.limits.memory`   | Limite Memory    | `2Gi`              |

## Esempi di Configurazione

### Esempio base

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Esempio con autenticazione

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Esempio con persistence

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

### Esempio con session affinity disabilitata

```yaml
affinity:
  enabled: false
```

### Esempio completo con Ingress

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

OpenCode richiede sticky sessions (session affinity) per funzionare correttamente quando ci sono più repliche. Questo è necessario perché il server mantiene lo stato della connessione con il client.

### Nginx Ingress

Per Nginx Ingress, la configurazione delle sticky sessions è automatica quando `affinity.enabled: true`. Il chart configura automaticamente le annotations necessarie:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # o persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Per Traefik, assicurarsi di configurare il middleware di sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Modi di Affinity

- **balanced**: Le richieste sono distribuite equamente tra i backend disponibili
- **persistent**: Le richieste sono dirette sempre allo stesso backend quando possibile

## Volumi

Il chart monta i seguenti volumi:

| Path                          | Descrizione                 |
| ----------------------------- | --------------------------- |
| `/root/.config/opencode`      | Directory di configurazione |
| `/root/.cache/opencode`       | Cache di opencode           |
| `/root/.local/share/opencode` | Dati di opencode            |

## Variabili di Ambiente

Le seguenti variabili di ambiente possono essere configurate tramite `env`:

| Variabile               | Descrizione                 | Valore Predefinito       |
| ----------------------- | --------------------------- | ------------------------ |
| `PORT`                  | Porta del server            | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Directory di configurazione | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Dominio mDNS                | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Abilitare mDNS              | `false`                  |

Esempio di configurazione di variabili di ambiente:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Risorse Aggiuntive

### Autoscaling

L'HPA (Horizontal Pod Autoscaler) può essere abilitato:

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

### Volumi Extra

Per montare volumi aggiuntivi:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Supporto a TLS automatico con cert-manager
- [ ] Esempi di configurazione per provider cloud
- [ ] Integrazione con Prometheus/Grafana per metriche
- [ ] Template per deployment con PostgreSQL
- [ ] Supporto a Helm tests

## Contribuzione

I contributi sono benvenuti! Si prega di inviare una PR o aprire un issue su [GitHub](https://github.com/anomalyco/opencode).

## Licenza

Apache License 2.0 - vedere [LICENSE](LICENSE) per i dettagli.
