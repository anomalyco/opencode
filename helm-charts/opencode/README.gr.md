# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart για την ανάπτυξη του OpenCode AI assistant server σε Kubernetes.

## Περιγραφή

Αυτό το Helm chart εγκαθιστά τον διακομιστή OpenCode AI Assistant σε ένα cluster Kubernetes. Το OpenCode είναι ένας βοηθός τεχνητής νοημοσύνης για την ανάπτυξη λογισμικού που μπορεί να ενσωματωθεί με editors κώδικα μέσω του Language Server Protocol (LSP).

## Προϋποθέσεις

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx ή traefik)

## Εγκατάσταση

### Προσθήκη του αποθετηρίου

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Βασική εγκατάσταση

```bash
helm install opencode opencode/opencode
```

### Εγκατάσταση με προσαρμοσμένες τιμές

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Εγκατάσταση με values file

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Διαμόρφωση

Ανατρέξτε στο αρχείο `values.yaml` για όλες τις παραμετρικές ρυθμίσεις.

### Κύριες Παράμετροι

| Παράμετρος           | Περιγραφή            | Προεπιλεγμένη Τιμή           |
| -------------------- | -------------------- | ---------------------------- |
| `image.repository`   | Docker Image         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image Tag            | `dev-alpine`                 |
| `replicaCount`       | Αριθμός αντιγράφων   | `1`                          |
| `service.type`       | Τύπος service        | `ClusterIP`                  |
| `service.port`       | Θύρα service         | `80`                         |
| `service.targetPort` | Θύρα container       | `4096`                       |
| `server.port`        | Θύρα opencode server | `4096`                       |

### Αυθεντικοποίηση

| Παράμετρος            | Περιγραφή                     | Προεπιλεγμένη Τιμή |
| --------------------- | ----------------------------- | ------------------ |
| `auth.enabled`        | Ενεργοποίηση αυθεντικοποίησης | `false`            |
| `auth.username`       | Όνομα χρήστη                  | `opencode`         |
| `auth.password`       | Κωδικός πρόσβασης             | `""`               |
| `auth.existingSecret` | Υπάρχον Secret                | `""`               |

### Session Affinity

| Παράμετρος            | Περιγραφή                        | Προεπιλεγμένη Τιμή |
| --------------------- | -------------------------------- | ------------------ |
| `affinity.enabled`    | Ενεργοποίηση sticky sessions     | `true`             |
| `affinity.cookieName` | Όνομα cookie                     | `OPENCODEAFFINITY` |
| `affinity.mode`       | Λειτουργία (balanced/persistent) | `balanced`         |
| `affinity.type`       | Τύπος (cookie)                   | `cookie`           |

### Persistence

| Παράμετρος                      | Περιγραφή            | Προεπιλεγμένη Τιμή |
| ------------------------------- | -------------------- | ------------------ |
| `persistence.data.enabled`      | PVC για δεδομένα     | `false`            |
| `persistence.data.storageClass` | StorageClass         | `""`               |
| `persistence.data.accessMode`   | Λειτουργία πρόσβασης | `ReadWriteOnce`    |
| `persistence.data.size`         | Μέγεθος              | `1Gi`              |
| `persistence.cache.enabled`     | PVC για cache        | `false`            |
| `persistence.config.enabled`    | PVC για config       | `false`            |

### ConfigMaps

| Παράμετρος                   | Περιγραφή             | Προεπιλεγμένη Τιμή |
| ---------------------------- | --------------------- | ------------------ |
| `configMaps.agents.enabled`  | Mount AGENTS.md       | `false`            |
| `configMaps.agents.data`     | Περιεχόμενο ConfigMap | `{}`               |
| `configMaps.docs.enabled`    | Mount τεκμηρίωση      | `false`            |
| `configMaps.docs.data`       | Περιεχόμενο ConfigMap | `{}`               |
| `configMaps.plugins.enabled` | Mount plugins         | `false`            |
| `configMaps.plugins.data`    | Περιεχόμενο ConfigMap | `{}`               |

### Πόροι

| Παράμετρος                  | Περιγραφή      | Προεπιλεγμένη Τιμή |
| --------------------------- | -------------- | ------------------ |
| `resources.requests.cpu`    | CPU request    | `100m`             |
| `resources.requests.memory` | Memory request | `128Mi`            |
| `resources.limits.cpu`      | CPU limit      | `2000m`            |
| `resources.limits.memory`   | Memory limit   | `2Gi`              |

## Παραδείγματα Διαμόρφωσης

### Βασικό παράδειγμα

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Παράδειγμα με αυθεντικοποίηση

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Παράδειγμα με persistence

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

### Παράδειγμα με απενεργοποιημένο session affinity

```yaml
affinity:
  enabled: false
```

### Πλήρες παράδειγμα με Ingress

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

Το OpenCode απαιτεί sticky sessions (session affinity) για να λειτουργήσει σωστά όταν υπάρχουν πολλαπλά αντίγραφα. Αυτό είναι απαραίτητο επειδή ο διακομιστής διατηρεί την κατάσταση της σύνδεσης με τον πελάτη.

### Nginx Ingress

Για Nginx Ingress, η διαμόρφωση sticky sessions είναι αυτόματη όταν `affinity.enabled: true`. Το chart διαμορφώνει αυτόματα τις απαραίτητες annotations:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # ή persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Για Traefik, βεβαιωθείτε ότι έχετε διαμορφώσει το middleware για sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Λειτουργίες Affinity

- **balanced**: Τα αιτήματα κατανέμονται εξίσου μεταξύ των διαθέσιμων backends
- **persistent**: Τα αιτήματα κατευθύνονται πάντα στο ίδιο backend όποτε είναι δυνατόν

## Volumes

Το chart τοποθετεί τα ακόλουθα volumes:

| Path                          | Περιγραφή             |
| ----------------------------- | --------------------- |
| `/root/.config/opencode`      | Κατάλογος διαμόρφωσης |
| `/root/.cache/opencode`       | Cache του opencode    |
| `/root/.local/share/opencode` | Δεδομένα του opencode |

## Μεταβλητές Περιβάλλοντος

Οι ακόλουθες μεταβλητές περιβάλλοντος μπορούν να διαμορφωθούν μέσω του `env`:

| Μεταβλητή               | Περιγραφή             | Προεπιλεγμένη Τιμή       |
| ----------------------- | --------------------- | ------------------------ |
| `PORT`                  | Θύρα διακομιστή       | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Κατάλογος διαμόρφωσης | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Τομέας mDNS           | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Ενεργοποίηση mDNS     | `false`                  |

Παράδειγμα διαμόρφωσης μεταβλητών περιβάλλοντος:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Επιπρόσθετοι Πόροι

### Autoscaling

Το HPA (Horizontal Pod Autoscaler) μπορεί να ενεργοποιηθεί:

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

Για την τοποθέτηση επιπρόσθετων volumes:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Υποστήριξη αυτόματης TLS με cert-manager
- [ ] Παραδείγματα διαμόρφωσης για cloud providers
- [ ] Ενσωμάτωση με Prometheus/Grafana για μετρήσεις
- [ ] Templates για deployment με PostgreSQL
- [ ] Υποστήριξη Helm tests

## Συνεισφορά

Οι συνεισφορές είναι ευπρόσδεκτες! Παρακαλώ στείλτε ένα PR ή ανοίξτε ένα issue στο [GitHub](https://github.com/anomalyco/opencode).

## Άδεια

Apache License 2.0 - δείτε το [LICENSE](LICENSE) για λεπτομέρειες.
