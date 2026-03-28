# Τεκμηρίωση OpenCode Server Docker

Αυτός ο οδηγός καλύπτει την εκτέλεση του OpenCode σε λειτουργία server μέσα σε Docker containers.

## Εισαγωγή

Το OpenCode Server είναι μια headless εγκατάσταση του OpenCode που εκτελείται ως υπηρεσία φόντου, προσβάσιμη μέσω HTTP API. Η εικόνα Docker παρέχει ένα πλήρες περιβάλλον εκτέλεσης με όλα τα απαραίτητα εργαλεία προεγκατεστημένα, καθιστώντας το ιδανικό για:

- Απομακρυσμένα περιβάλλοντα ανάπτυξης
- Ενσωμάτωση CI/CD
- Κοινόχρηστες περιπτώσεις κωδικοποίησης για ομάδες
- Εκτέλεση OpenCode σε servers χωρίς GUI

## Γρήγορη Εκκίνηση

Εκτελέστε το OpenCode Server με έναν ασφαλή κωδικό πρόσβασης:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Αποκτήστε πρόσβαση στον server στη διεύθυνση `http://localhost:3000`.

## Παραλλαγές Εικόνας

Διατίθενται δύο παραλλαγές βασικής εικόνας:

| Παραλλαγή | Βασική Εικόνα      | Μέγεθος | Περίπτωση Χρήσης                          |
| --------- | ------------------ | ------- | ----------------------------------------- |
| `debian`  | Debian Trixie Slim | ~500MB  | Συνιστάται για τους περισσότερους χρήστες |
| `alpine`  | Alpine Edge        | ~200MB  | Ελάχιστο αποτύπωμα, ταχύτερη λήψη         |

### Λήψη Συγκεκριμένων Παραλλαγών

```bash
# Debian (συνιστάται)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (ελάχιστο)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Μεταβλητές Περιβάλλοντος

| Μεταβλητή                  | Προεπιλογή                    | Περιγραφή                                                       |
| -------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (καμία)                       | **Απαιτείται.** Κωδικός πρόσβασης για HTTP Basic authentication |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Όνομα χρήστη για HTTP Basic authentication                      |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Κατάλογος διαμόρφωσης                                           |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Κατάλογος προσωρινής αποθήκευσης                                |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Κατάλογος δεδομένων                                             |

### Επιλογές Server (CLI Flags)

Ο server δέχεται αυτές τις επιπλέον επιλογές κατά την αντικατάσταση της προεπιλεγμένης εντολής:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Προεπιλογή       | Περιγραφή                              |
| --------------- | ---------------- | -------------------------------------- |
| `--port`        | `0` (τυχαίο)     | Θύρα για ακρόαση                       |
| `--hostname`    | `127.0.0.1`      | Hostname για σύνδεση                   |
| `--mdns`        | `false`          | Ενεργοποίηση ανακάλυψης υπηρεσίας mDNS |
| `--mdns-domain` | `opencode.local` | Προσαρμοσμένο domain name mDNS         |
| `--cors`        | `[]`             | Επιπλέον domains επιτρεπόμενα για CORS |

## Mount Volumes

Κάντε mount αυτούς τους τόμους για να διατηρήσετε δεδομένα και να μοιραστείτε πόρους:

### Workspace (Απαιτείται)

```bash
-v /path/to/workspace:/workspace
```

Εδώ λειτουργεί το OpenCode με τα αρχεία του project σας. Κάντε mount το repository του κώδικά σας εδώ.

### SSH Keys

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Πρόσβαση μόνο για ανάγνωση στα SSH keys για κλωνοποίηση ιδιωτικών repositories.

### Διαμόρφωση Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Κληρονομή της ταυτότητας χρήστη Git από τον host.

### Διαμόρφωση OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Διατήρηση ρυθμίσεων OpenCode μεταξύ επανεκκινήσεων του container.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache για πακέτα npm, language servers και άλλα εργαλεία που έχουν ληφθεί.

## Θύρες

| Θύρα   | Πρωτόκολλο | Περιγραφή                         |
| ------ | ---------- | --------------------------------- |
| `3000` | HTTP       | Κύριο API του server (προεπιλογή) |

Η θύρα μπορεί να αντιστοιχιστεί μέσω της επιλογής `-p` του Docker:

```bash
-p 8080:3000  # Πρόσβαση στον server στο http://localhost:8080
```

## Χρήστης και Δικαιώματα

Το container εκτελείται ως μη-root χρήστης (`opencode`, UID 1000) για ασφάλεια. Αυτός ο χρήστης έχει πρόσβαση `sudo` χωρίς κωδικό για διοικητικές εργασίες:

```bash
# Εκτέλεση εντολών ως χρήστης opencode
docker exec -it opencode-server sudo -u opencode <command>

# Απόκτηση shell ως χρήστης opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Αν χρειάζεστε πρόσβαση root:

```bash
docker exec -it opencode-server /bin/bash
```

## Εγκατεστημένα Εργαλεία

Η εικόνα περιλαμβάνει αυτά τα εργαλεία έτοιμα προς χρήση:

| Εργαλείο          | Περιγραφή                                             |
| ----------------- | ----------------------------------------------------- |
| `opencode`        | OpenCode CLI                                          |
| `bun`             | JavaScript runtime και package manager                |
| `bunx`            | Το αντίστοιχο του npx της Bun (εκτέλεση npm packages) |
| `uv`              | Python package manager                                |
| `git`             | Έλεγχος εκδόσεων                                      |
| `git-lfs`         | Επέκταση μεγάλης αποθήκευσης αρχείων για Git          |
| `build-essential` | GCC, make και βιβλιοθήκες build                       |
| `curl`            | HTTP client                                           |
| `wget`            | Εργαλείο λήψης αρχείων                                |
| `openssh-client`  | SSH client και εργαλείο κλειδιών                      |
| `xz-utils`        | Εργαλεία συμπίεσης                                    |

### Χρήση του bun

```bash
# Εκτέλεση πακέτου Node.js
docker exec -it opencode-server bunx create-next-app

# Εγκατάσταση εξαρτήσεων
docker exec -it opencode-server bun install
```

### Χρήση του uv

```bash
# Εγκατάσταση πακέτου Python
docker exec -it opencode-server uv pip install pandas

# Εκτέληση Python script
docker exec -it opencode-server uv run script.py
```

### Χρήση του git

```bash
# Κλωνοποίηση repository στο workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

Το container περιλαμβάνει ένα ενσωματωμένο health check που επαληθεύει ότι ο server ανταποκρίνεται:

```bash
# Έλεγχος υγείας container
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Το health endpoint επιστρέφει HTTP 200 όταν είναι υγιές:

```bash
# Χειροκίνητος έλεγχος υγείας
curl -f http://localhost:3000/health
```

Διαμόρφωση health check:

- Interval: 30 δευτερόλεπτα
- Timeout: 10 δευτερόλεπτα
- Start period: 10 δευτερόλεπτα
- Retries: 3

## Παράδειγμα Docker Compose

Δημιουργήστε ένα αρχείο `docker-compose.yml`:

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

Εκκινήστε το stack:

```bash
docker-compose up -d
```

## Κατασκευή από Πηγαίο Κώδικα

Για να κατασκευάσετε την εικόνα server από πηγαίο κώδικα:

### Κλωνοποίηση του repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Κατασκευή παραλλαγής Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Κατασκευή παραλλαγής Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Εκτέλεση της τοπικής κατασκευής

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Αντιμετώπιση Προβλημάτων

### Ο server δεν ξεκινά

Ελέγξτε τα logs:

```bash
docker logs opencode-server
```

Συνήθη προβλήματα:

- Λείπει το `OPENCODE_SERVER_PASSWORD` - ο server αρνείται να ξεκινήσει χωρίς έλεγχο ταυτότητας
- Η θύρα χρησιμοποιείται ήδη - αλλάξτε την αντιστοίχιση θύρας του host

### Ο έλεγχος ταυτότητας αποτυγχάνει

Βεβαιωθείτε ότι ο κωδικός ταιριάζει ακριβώς. Ο server χρησιμοποιεί HTTP Basic Auth:

```bash
# Δοκιμή ελέγχου ταυτότητας
curl -u opencode:your_password http://localhost:3000/health
```

### Σφάλματα δικαιωμάτων Workspace

Βεβαιωθείτε ότι ο mounted κατάλογος είναι εγγράψιμος από UID 1000:

```bash
# Διόρθωση ιδιοκτησίας
sudo chown -R 1000:1000 /path/to/workspace
```

### Αργή εκκίνηση

Η πρώτη εκτέλυση κατεβάζει language servers και εργαλεία. Ελέγξτε την πρόοδο:

```bash
docker logs -f opencode-server
```

### Το container δεν μπορεί να συνδεθεί στο internet

Ελέγξτε τη διαμόρφωση DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Το health check αποτυγχάνει

Επαληθεύστε ότι ο server εκτελείται πραγματικά:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### Το SSH key δεν λειτουργεί

Βεβαιωθείτε για τα σωστά δικαιώματα κλειδιού μέσα στο container:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
