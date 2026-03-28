# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Chart Helm pour déployer le serveur assistant IA OpenCode sur Kubernetes.

## Description

Ce chart Helm installe le serveur OpenCode AI Assistant sur un cluster Kubernetes. OpenCode est un assistant IA pour le développement de logiciels qui peut être intégré aux éditeurs de code via le Language Server Protocol (LSP).

## Prérequis

- Kubernetes 1.19+
- Helm 3+
- Contrôleur d'ingress (nginx ou traefik)

## Installation

### Ajouter le dépôt

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Installation basique

```bash
helm install opencode opencode/opencode
```

### Installation avec des valeurs personnalisées

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Installation avec fichier values

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Configuration

Consultez le fichier `values.yaml` pour voir tous les paramètres configurables.

### Paramètres principaux

| Paramètre            | Description              | Valeur par défaut            |
| -------------------- | ------------------------ | ---------------------------- |
| `image.repository`   | Image Docker             | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag de l'image           | `dev-alpine`                 |
| `replicaCount`       | Nombre de réplicas       | `1`                          |
| `service.type`       | Type de service          | `ClusterIP`                  |
| `service.port`       | Port du service          | `80`                         |
| `service.targetPort` | Port du conteneur        | `4096`                       |
| `server.port`        | Port du serveur opencode | `4096`                       |

### Authentification

| Paramètre             | Description                | Valeur par défaut |
| --------------------- | -------------------------- | ----------------- |
| `auth.enabled`        | Activer l'authentification | `false`           |
| `auth.username`       | Nom d'utilisateur          | `opencode`        |
| `auth.password`       | Mot de passe               | `""`              |
| `auth.existingSecret` | Secret existant            | `""`              |

### Affinité de session

| Paramètre             | Description                       | Valeur par défaut  |
| --------------------- | --------------------------------- | ------------------ |
| `affinity.enabled`    | Activer les sessions persistantes | `true`             |
| `affinity.cookieName` | Nom du cookie                     | `OPENCODEAFFINITY` |
| `affinity.mode`       | Mode (balanced/persistent)        | `balanced`         |
| `affinity.type`       | Type (cookie)                     | `cookie`           |

### Persistance

| Paramètre                       | Description      | Valeur par défaut |
| ------------------------------- | ---------------- | ----------------- |
| `persistence.data.enabled`      | PVC pour données | `false`           |
| `persistence.data.storageClass` | StorageClass     | `""`              |
| `persistence.data.accessMode`   | Mode d'accès     | `ReadWriteOnce`   |
| `persistence.data.size`         | Taille           | `1Gi`             |
| `persistence.cache.enabled`     | PVC pour cache   | `false`           |
| `persistence.config.enabled`    | PVC pour config  | `false`           |

### ConfigMaps

| Paramètre                    | Description             | Valeur par défaut |
| ---------------------------- | ----------------------- | ----------------- |
| `configMaps.agents.enabled`  | Monter AGENTS.md        | `false`           |
| `configMaps.agents.data`     | Contenu du ConfigMap    | `{}`              |
| `configMaps.docs.enabled`    | Monter la documentation | `false`           |
| `configMaps.docs.data`       | Contenu du ConfigMap    | `{}`              |
| `configMaps.plugins.enabled` | Monter les plugins      | `false`           |
| `configMaps.plugins.data`    | Contenu du ConfigMap    | `{}`              |

### Ressources

| Paramètre                   | Description     | Valeur par défaut |
| --------------------------- | --------------- | ----------------- |
| `resources.requests.cpu`    | Requête CPU     | `100m`            |
| `resources.requests.memory` | Requête mémoire | `128Mi`           |
| `resources.limits.cpu`      | Limite CPU      | `2000m`           |
| `resources.limits.memory`   | Limite mémoire  | `2Gi`             |

## Exemples de configuration

### Exemple basique

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Exemple avec authentification

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Exemple avec persistance

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

### Exemple avec affinité de session désactivée

```yaml
affinity:
  enabled: false
```

### Exemple complet avec Ingress

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

## Affinité de session

OpenCode nécessite des sessions persistantes (affinité de session) pour fonctionner correctement lorsqu'il y a plusieurs réplicas. Cela est nécessaire car le serveur maintient l'état de la connexion avec le client.

### Nginx Ingress

Pour Nginx Ingress, la configuration des sessions persistantes est automatique lorsque `affinity.enabled: true`. Le chart configure automatiquement les annotations nécessaires :

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # ou persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Pour Traefik, assurez-vous de configurer le middleware des sessions persistantes :

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Modes d'affinité

- **balanced** : Les requêtes sont réparties uniformément entre les backends disponibles
- **persistent** : Les requêtes sont toujours dirigées vers le même backend si possible

## Volumes

Le chart monte les volumes suivants :

| Path                          | Description                 |
| ----------------------------- | --------------------------- |
| `/root/.config/opencode`      | Répertoire de configuration |
| `/root/.cache/opencode`       | Cache d'opencode            |
| `/root/.local/share/opencode` | Données d'opencode          |

## Variables d'environnement

Les variables d'environnement suivantes peuvent être configurées via `env` :

| Variable                | Description                 | Valeur par défaut        |
| ----------------------- | --------------------------- | ------------------------ |
| `PORT`                  | Port du serveur             | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Répertoire de configuration | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Domaine mDNS                | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Activer mDNS                | `false`                  |

Exemple de configuration de variables d'environnement :

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Ressources supplémentaires

### Autoscaling

Le HPA (Horizontal Pod Autoscaler) peut être activé :

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Contexte de sécurité

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### Volumes supplémentaires

Pour monter des volumes supplémentaires :

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Feuille de route

- [ ] Support TLS automatique avec cert-manager
- [ ] Exemples de configuration pour les fournisseurs cloud
- [ ] Intégration avec Prometheus/Grafana pour les métriques
- [ ] Modèles pour le déploiement avec PostgreSQL
- [ ] Support des tests Helm

## Contribution

Les contributions sont les bienvenues ! Veuillez envoyer une PR ou ouvrir une issue sur [GitHub](https://github.com/anomalyco/opencode).

## Licence

Apache License 2.0 - voir [LICENSE](LICENSE) pour les détails.
