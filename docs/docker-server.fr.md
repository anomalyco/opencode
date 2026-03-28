# Documentation Docker OpenCode Server

Ce guide couvre l'exécution d'OpenCode en mode serveur dans des conteneurs Docker.

## Introduction

OpenCode Server est un déploiement headless d'OpenCode qui s'exécute en tant que service d'arrière-plan, accessible via l'API HTTP. L'image Docker fournit un environnement d'exécution complet avec tous les outils nécessaires préinstallés, idéal pour :

- Environnements de développement distant
- Intégration CI/CD
- Instances de codage partagées pour les équipes
- Exécution d'OpenCode sur des serveurs sans interface graphique

## Démarrage Rapide

Exécutez OpenCode Server avec un mot de passe sécurisé :

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Accédez au serveur à l'adresse `http://localhost:3000`.

## Variantes d'Image

Deux variantes d'image de base sont disponibles :

| Variante | Image de Base      | Taille | Cas d'Usage                          |
| -------- | ------------------ | ------ | ------------------------------------ |
| `debian` | Debian Trixie Slim | ~500MB | Recommandé pour la plupart           |
| `alpine` | Alpine Edge        | ~200MB | Empreinte minimale, pull plus rapide |

### Pull de Variantes Spécifiques

```bash
# Debian (recommandé)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Variables d'Environnement

| Variable                   | Par Défaut                    | Description                                                 |
| -------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (aucune)                      | **Requis.** Mot de passe pour l'authentification HTTP Basic |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Nom d'utilisateur pour l'authentification HTTP Basic        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Répertoire de configuration                                 |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Répertoire de cache                                         |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Répertoire de données                                       |

### Options du Serveur (Flags CLI)

Le serveur accepte ces options supplémentaires lors du remplacement de la commande par défaut :

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Par Défaut       | Description                             |
| --------------- | ---------------- | --------------------------------------- |
| `--port`        | `0` (aléatoire)  | Port d'écoute                           |
| `--hostname`    | `127.0.0.1`      | Nom d'hôte de liaison                   |
| `--mdns`        | `false`          | Activer la découverte de service mDNS   |
| `--mdns-domain` | `opencode.local` | Nom de domaine mDNS personnalisé        |
| `--cors`        | `[]`             | Domaines CORS supplémentaires autorisés |

## Montages de Volumes

Montez ces volumes pour persister les données et partager les ressources :

### Espace de Travail (Requis)

```bash
-v /path/to/workspace:/workspace
```

C'est là qu'OpenCode fonctionne sur vos fichiers de projet. Montez votre dépôt de code ici.

### Clés SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Accès en lecture seule aux clés SSH pour cloner des dépôts privés.

### Configuration Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Hériter de l'identité utilisateur Git de l'hôte.

### Configuration OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Persister les paramètres OpenCode entre les redémarrages du conteneur.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache des packages npm, serveurs de langage et autres outils téléchargés.

## Ports

| Port   | Protocole | Description                        |
| ------ | --------- | ---------------------------------- |
| `3000` | HTTP      | API principale du serveur (défaut) |

Le port peut être redéfini via le flag `-p` de Docker :

```bash
-p 8080:3000  # Accéder au serveur à http://localhost:8080
```

## Utilisateur et Permissions

Le conteneur s'exécute en tant qu'utilisateur non-root (`opencode`, UID 1000) pour des raisons de sécurité. Cet utilisateur a un accès `sudo` sans mot de passe pour les tâches administratives :

```bash
# Exécuter des commandes en tant qu'utilisateur opencode
docker exec -it opencode-server sudo -u opencode <command>

# Obtenir un shell en tant qu'utilisateur opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Si vous avez besoin d'un accès root :

```bash
docker exec -it opencode-server /bin/bash
```

## Outils Installés

L'image inclut ces outils prêts à l'emploi :

| Outil             | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `opencode`        | CLI OpenCode                                           |
| `bun`             | Runtime JavaScript et gestionnaire de packages         |
| `bunx`            | Équivalent de Bun pour npx (exécuter des packages npm) |
| `uv`              | Gestionnaire de packages Python                        |
| `git`             | Contrôle de version                                    |
| `git-lfs`         | Extension de stockage de fichiers volumineux pour Git  |
| `build-essential` | GCC, make et bibliothèques de compilation              |
| `curl`            | Client HTTP                                            |
| `wget`            | Utilitaire de téléchargement de fichiers               |
| `openssh-client`  | Client SSH et outils de clés                           |
| `xz-utils`        | Utilitaires de compression                             |

### Utiliser bun

```bash
# Exécuter un package Node.js
docker exec -it opencode-server bunx create-next-app

# Installer les dépendances
docker exec -it opencode-server bun install
```

### Utiliser uv

```bash
# Installer un package Python
docker exec -it opencode-server uv pip install pandas

# Exécuter un script Python
docker exec -it opencode-server uv run script.py
```

### Utiliser git

```bash
# Cloner un dépôt dans l'espace de travail
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Vérification de Santé

Le conteneur inclut une vérification de santé intégrée qui vérifie que le serveur répond :

```bash
# Vérifier la santé du conteneur
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Le point de terminaison de santé retourne HTTP 200 lorsqu'il est sain :

```bash
# Vérification de santé manuelle
curl -f http://localhost:3000/health
```

Configuration de la vérification de santé :

- Intervalle : 30 secondes
- Timeout : 10 secondes
- Période de démarrage : 10 secondes
- Réessais : 3

## Exemple Docker Compose

Créez un fichier `docker-compose.yml` :

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

Démarrez le stack :

```bash
docker-compose up -d
```

## Construction depuis les Sources

Pour construire l'image du serveur depuis les sources :

### Cloner le dépôt

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Construire la variante Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Construire la variante Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Exécuter votre build local

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Dépannage

### Le serveur ne démarre pas

Vérifiez les logs :

```bash
docker logs opencode-server
```

Problèmes courants :

- `OPENCODE_SERVER_PASSWORD` manquant - le serveur refuse de démarrer sans authentification
- Port déjà utilisé - changez le mappage de port hôte

### Échec de l'authentification

Assurez-vous que le mot de passe correspond exactement. Le serveur utilise HTTP Basic Auth :

```bash
# Tester l'authentification
curl -u opencode:your_password http://localhost:3000/health
```

### Erreurs de permissions de l'espace de travail

Assurez-vous que le répertoire montée est inscriptible par UID 1000 :

```bash
# Corriger la propriété
sudo chown -R 1000:1000 /path/to/workspace
```

### Démarrage lent

La première exécution télécharge les serveurs de langage et les outils. Vérifiez la progression :

```bash
docker logs -f opencode-server
```

### Le conteneur ne peut pas accéder à internet

Vérifiez la configuration DNS :

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### La vérification de santé échoue

Vérifiez que le serveur fonctionne réellement :

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### La clé SSH ne fonctionne pas

Assurez-vous des permissions de clé appropriées à l'intérieur du conteneur :

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
