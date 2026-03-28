# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Kubernetes'te OpenCode AI asistan sunucusunu dağıtmak için Helm chart'ı.

## Açıklama

Bu Helm chart, bir Kubernetes kümesine OpenCode AI Assistant sunucusunu kurar. OpenCode, Language Server Protocol (LSP) aracılığıyla kod editörleriyle entegre edilebilen bir yazılım geliştirme asistanıdır.

## Ön Koşullar

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx veya traefik)

## Kurulum

### Depoyu ekleme

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Temel kurulum

```bash
helm install opencode opencode/opencode
```

### Özelleştirilmiş değerlerle kurulum

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Values dosyası ile kurulum

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Yapılandırma

Tüm yapılandırılabilir parametreler için `values.yaml` dosyasına bakın.

### Ana Parametreler

| Parametre            | Açıklama              | Varsayılan Değer             |
| -------------------- | --------------------- | ---------------------------- |
| `image.repository`   | Docker image          | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image tag             | `dev-alpine`                 |
| `replicaCount`       | Replika sayısı        | `1`                          |
| `service.type`       | Service tipi          | `ClusterIP`                  |
| `service.port`       | Service portu         | `80`                         |
| `service.targetPort` | Container portu       | `4096`                       |
| `server.port`        | Opencode sunucu portu | `4096`                       |

### Kimlik Doğrulama

| Parametre             | Açıklama                       | Varsayılan Değer |
| --------------------- | ------------------------------ | ---------------- |
| `auth.enabled`        | Kimlik doğrulamayı etkinleştir | `false`          |
| `auth.username`       | Kullanıcı adı                  | `opencode`       |
| `auth.password`       | Şifre                          | `""`             |
| `auth.existingSecret` | Mevcut secret                  | `""`             |

### Oturum Affinity'si

| Parametre             | Açıklama                        | Varsayılan Değer   |
| --------------------- | ------------------------------- | ------------------ |
| `affinity.enabled`    | Sticky session'leri etkinleştir | `true`             |
| `affinity.cookieName` | Cookie adı                      | `OPENCODEAFFINITY` |
| `affinity.mode`       | Mod (balanced/persistent)       | `balanced`         |
| `affinity.type`       | Tip (cookie)                    | `cookie`           |

### Kalıcılık

| Parametre                       | Açıklama             | Varsayılan Değer |
| ------------------------------- | -------------------- | ---------------- |
| `persistence.data.enabled`      | PVC for veri         | `false`          |
| `persistence.data.storageClass` | StorageClass         | `""`             |
| `persistence.data.accessMode`   | Erişim modu          | `ReadWriteOnce`  |
| `persistence.data.size`         | Boyut                | `1Gi`            |
| `persistence.cache.enabled`     | PVC for önbellek     | `false`          |
| `persistence.config.enabled`    | PVC for yapılandırma | `false`          |

### ConfigMap'ler

| Parametre                    | Açıklama             | Varsayılan Değer |
| ---------------------------- | -------------------- | ---------------- |
| `configMaps.agents.enabled`  | AGENTS.md'yi bağla   | `false`          |
| `configMaps.agents.data`     | ConfigMap içeriği    | `{}`             |
| `configMaps.docs.enabled`    | Dokümantasyonu bağla | `false`          |
| `configMaps.docs.data`       | ConfigMap içeriği    | `{}`             |
| `configMaps.plugins.enabled` | Eklentileri bağla    | `false`          |
| `configMaps.plugins.data`    | ConfigMap içeriği    | `{}`             |

### Kaynaklar

| Parametre                   | Açıklama      | Varsayılan Değer |
| --------------------------- | ------------- | ---------------- |
| `resources.requests.cpu`    | CPU isteği    | `100m`           |
| `resources.requests.memory` | Bellek isteği | `128Mi`          |
| `resources.limits.cpu`      | CPU limiti    | `2000m`          |
| `resources.limits.memory`   | Bellek limiti | `2Gi`            |

## Yapılandırma Örnekleri

### Temel örnek

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Kimlik doğrulama ile örnek

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Kalıcılık ile örnek

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

### Oturum affinity'si devre dışı bırakılmış örnek

```yaml
affinity:
  enabled: false
```

### Ingress ile tam örnek

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

## Oturum Affinity'si

OpenCode, birden fazla replika olduğunda düzgün çalışması için sticky sessions (oturum affinity'si) gerektirir. Bunun nedeni, sunucunun istemciyle bağlantı durumunu korumasıdır.

### Nginx Ingress

Nginx Ingress için, sticky sessions yapılandırması `affinity.enabled: true` olduğunda otomatiktir. Chart gerekli açıklamaları otomatik olarak yapılandırır:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # veya persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Traefik için, sticky sessions middleware'sini yapılandırdığınızdan emin olun:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity Modları

- **balanced**: İstekler mevcut backend'ler arasında eşit olarak dağıtılır
- **persistent**: İstekler mümkünse her zaman aynı backend'e yönlendirilir

## Birimler

Chart şu birimleri bağlar:

| Path                          | Açıklama            |
| ----------------------------- | ------------------- |
| `/root/.config/opencode`      | Yapılandırma dizini |
| `/root/.cache/opencode`       | Opencode önbelleği  |
| `/root/.local/share/opencode` | Opencode verileri   |

## Ortam Değişkenleri

Aşağıdaki ortam değişkenleri `env` aracılığıyla yapılandırılabilir:

| Değişken                | Açıklama            | Varsayılan Değer         |
| ----------------------- | ------------------- | ------------------------ |
| `PORT`                  | Sunucu portu        | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Yapılandırma dizini | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS domaini        | `local`                  |
| `OPENCODE_MDNS_ENABLED` | mDNS'yi etkinleştir | `false`                  |

Ortam değişkenleri yapılandırma örneği:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Ek Özellikler

### Otomatik Ölçeklendirme

HPA (Horizontal Pod Autoscaler) etkinleştirilebilir:

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Güvenlik Bağlamı

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### Ek Birimler

Ek birimler bağlamak için:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Yol Haritası

- [ ] cert-manager ile otomatik TLS desteği
- [ ] Bulut sağlayıcıları için yapılandırma örnekleri
- [ ] Prometheus/Grafana entegrasyonu için metrics
- [ ] PostgreSQL ile deployment şablonları
- [ ] Helm testleri desteği

## Katkı

Katkılarınızı bekliyoruz! Lütfen [GitHub](https://github.com/anomalyco/opencode) üzerinden bir PR gönderin veya bir issue açın.

## Lisans

Apache License 2.0 - Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
