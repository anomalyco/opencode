# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart za implementaciju OpenCode AI assistant servera na Kubernetesu.

## Opis

Ovaj Helm chart instalira OpenCode AI Assistant server na Kubernetes klasteru. OpenCode je AI asistent za razvoj softvera koji se može integrisati sa uređivačima koda putem Language Server Protocol (LSP).

## Preduvjeti

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx ili traefik)

## Instalacija

### Dodavanje repozitorija

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Osnovna instalacija

```bash
helm install opencode opencode/opencode
```

### Instalacija sa prilagođenim vrijednostima

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Instalacija sa values fajlom

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Konfiguracija

Pogledajte fajl `values.yaml` za sve konfigurabilne parametre.

### Glavni Parametri

| Parametar            | Opis                  | Zadana vrijednost            |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker slika          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag slike             | `dev-alpine`                 |
| `replicaCount`       | Broj replika          | `1`                          |
| `service.type`       | Tip servisa           | `ClusterIP`                  |
| `service.port`       | Port servisa          | `80`                         |
| `service.targetPort` | Port containera       | `4096`                       |
| `server.port`        | Port opencode servera | `4096`                       |

### Autentikacija

| Parametar             | Opis                  | Zadana vrijednost |
| --------------------- | --------------------- | ----------------- |
| `auth.enabled`        | Omogući autentikaciju | `false`           |
| `auth.username`       | Korisničko ime        | `opencode`        |
| `auth.password`       | Lozinka               | `""`              |
| `auth.existingSecret` | Postojeći secret      | `""`              |

### Session Affinity

| Parametar             | Opis                      | Zadana vrijednost  |
| --------------------- | ------------------------- | ------------------ |
| `affinity.enabled`    | Omogući sticky sessions   | `true`             |
| `affinity.cookieName` | Ime kolačića              | `OPENCODEAFFINITY` |
| `affinity.mode`       | Mod (balanced/persistent) | `balanced`         |
| `affinity.type`       | Tip (cookie)              | `cookie`           |

### Persistence

| Parametar                       | Opis           | Zadana vrijednost |
| ------------------------------- | -------------- | ----------------- |
| `persistence.data.enabled`      | PVC za podatke | `false`           |
| `persistence.data.storageClass` | StorageClass   | `""`              |
| `persistence.data.accessMode`   | Režim pristupa | `ReadWriteOnce`   |
| `persistence.data.size`         | Veličina       | `1Gi`             |
| `persistence.cache.enabled`     | PVC za cache   | `false`           |
| `persistence.config.enabled`    | PVC za config  | `false`           |

### ConfigMaps

| Parametar                    | Opis                   | Zadana vrijednost |
| ---------------------------- | ---------------------- | ----------------- |
| `configMaps.agents.enabled`  | Montiraj AGENTS.md     | `false`           |
| `configMaps.agents.data`     | Sadržaj ConfigMap-a    | `{}`              |
| `configMaps.docs.enabled`    | Montiraj dokumentaciju | `false`           |
| `configMaps.docs.data`       | Sadržaj ConfigMap-a    | `{}`              |
| `configMaps.plugins.enabled` | Montiraj plugine       | `false`           |
| `configMaps.plugins.data`    | Sadržaj ConfigMap-a    | `{}`              |

### Resursi

| Parametar                   | Opis           | Zadana vrijednost |
| --------------------------- | -------------- | ----------------- |
| `resources.requests.cpu`    | CPU request    | `100m`            |
| `resources.requests.memory` | Memory request | `128Mi`           |
| `resources.limits.cpu`      | CPU limit      | `2000m`           |
| `resources.limits.memory`   | Memory limit   | `2Gi`             |

## Primjeri Konfiguracije

### Osnovni primjer

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Primjer sa autentikacijom

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Primjer sa persistence

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

### Primjer sa onemogućenom session affinity

```yaml
affinity:
  enabled: false
```

### Kompletan primjer sa Ingress

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

OpenCode zahtijeva sticky sessions (session affinity) da bi ispravno radio kada ima više replika. To je neophodno jer server održava stanje konekcije sa klijentom.

### Nginx Ingress

Za Nginx Ingress, konfiguracija sticky sessions je automatska kada je `affinity.enabled: true`. Chart automatski konfiguriše potrebne anotacije:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # ili persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Za Traefik, pobrinite se da konfigurišete middleware za sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Modovi Affinity

- **balanced**: Zahtjevi se jednako distribuiraju između dostupnih backend-ova
- **persistent**: Zahtjevi se uvijek usmjeravaju na isti backend kada je moguće

## Volumeni

Chart montira sljedeće volumene:

| Path                          | Opis                      |
| ----------------------------- | ------------------------- |
| `/root/.config/opencode`      | Konfiguracioni direktorij |
| `/root/.cache/opencode`       | Cache opencode-a          |
| `/root/.local/share/opencode` | Podaci opencode-a         |

## Varijable Okruženja

Sljedeće varijable okruženja mogu se konfigurisati putem `env`:

| Varijable               | Opis                      | Zadana vrijednost        |
| ----------------------- | ------------------------- | ------------------------ |
| `PORT`                  | Port servera              | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Konfiguracioni direktorij | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS domen                | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Omogući mDNS              | `false`                  |

Primjer konfiguracije varijabli okruženja:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Dodatni Resursi

### Autoscaling

HPA (Horizontal Pod Autoscaler) može se omogućiti:

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

### Extra Volumeni

Za montiranje dodatnih volumena:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Podrška za automatski TLS sa cert-manager
- [ ] Primjeri konfiguracije za cloud provajdere
- [ ] Integracija sa Prometheus/Grafana za metrike
- [ ] Šabloni za deployment sa PostgreSQL-om
- [ ] Podrška za Helm testove

## Doprinos

Doprinosi su dobrodošli! Molimo pošaljite PR ili otvorite issue na [GitHub](https://github.com/anomalyco/opencode).

## Licenca

Apache License 2.0 - pogledajte [LICENSE](LICENSE) za detalje.
