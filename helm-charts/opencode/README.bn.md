# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Kubernetes-এ OpenCode AI অ্যাসিস্ট্যান্ট সার্ভার স্থাপনের জন্য Helm chart।

## বিবরণ

এই Helm chart একটি Kubernetes ক্লাস্টারে OpenCode AI অ্যাসিস্ট্যান্ট সার্ভার ইনস্টল করে। OpenCode হলো একটি সফটওয়্যার ডেভেলপমেন্টের জন্য AI অ্যাসিস্ট্যান্ট যা Language Server Protocol (LSP) এর মাধ্যমে কোড এডিটরের সাথে সংহত করা যায়।

## পূর্বশর্ত

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx অথবা traefik)

## ইনস্টলেশন

### রেপোজিটরি যোগ করুন

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### মৌলিক ইনস্টলেশন

```bash
helm install opencode opencode/opencode
```

### কাস্টম মান সহ ইনস্টলেশন

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### values file এর সাথে ইনস্টলেশন

```bash
helm install opencode opencode/opencode -f values.yaml
```

## কনফিগারেশন

সকল কনফিগারযোগ্য প্যারামিটার দেখতে `values.yaml` ফাইলটি দেখুন।

### প্রধান প্যারামিটার

| প্যারামিটার          | বিবরণ                  | ডিফল্ট মান                   |
| -------------------- | ---------------------- | ---------------------------- |
| `image.repository`   | Docker ইমেজ            | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | ইমেজ ট্যাগ             | `dev-alpine`                 |
| `replicaCount`       | রেপ্লিকার সংখ্যা       | `1`                          |
| `service.type`       | সার্ভিসের ধরন          | `ClusterIP`                  |
| `service.port`       | সার্ভিস পোর্ট          | `80`                         |
| `service.targetPort` | কন্টেইনার পোর্ট        | `4096`                       |
| `server.port`        | opencode সার্ভার পোর্ট | `4096`                       |

### প্রমাণীকরণ

| প্যারামিটার           | বিবরণ                   | ডিফল্ট মান |
| --------------------- | ----------------------- | ---------- |
| `auth.enabled`        | প্রমাণীকরণ সক্রিয় করুন | `false`    |
| `auth.username`       | ইউজারনেম                | `opencode` |
| `auth.password`       | পাসওয়ার্ড              | `""`       |
| `auth.existingSecret` | বিদ্যমান সিক্রেট        | `""`       |

### Session Affinity

| প্যারামিটার           | বিবরণ                     | ডিফল্ট মান         |
| --------------------- | ------------------------- | ------------------ |
| `affinity.enabled`    | স্টিকি সেশন সক্রিয় করুন  | `true`             |
| `affinity.cookieName` | কুকির নাম                 | `OPENCODEAFFINITY` |
| `affinity.mode`       | মোড (balanced/persistent) | `balanced`         |
| `affinity.type`       | টাইপ (cookie)             | `cookie`           |

### Persistence

| প্যারামিটার                     | বিবরণ            | ডিফল্ট মান      |
| ------------------------------- | ---------------- | --------------- |
| `persistence.data.enabled`      | PVC ডেটার জন্য   | `false`         |
| `persistence.data.storageClass` | StorageClass     | `""`            |
| `persistence.data.accessMode`   | অ্যাকসেস মোড     | `ReadWriteOnce` |
| `persistence.data.size`         | আকার             | `1Gi`           |
| `persistence.cache.enabled`     | PVC ক্যাশের জন্য | `false`         |
| `persistence.config.enabled`    | PVC কনফিগের জন্য | `false`         |

### ConfigMaps

| প্যারামিটার                  | বিবরণ              | ডিফল্ট মান |
| ---------------------------- | ------------------ | ---------- |
| `configMaps.agents.enabled`  | AGENTS.md মাউন্ট   | `false`    |
| `configMaps.agents.data`     | ConfigMap কন্টেন্ট | `{}`       |
| `configMaps.docs.enabled`    | ডকুমেন্টেশন মাউন্ট | `false`    |
| `configMaps.docs.data`       | ConfigMap কন্টেন্ট | `{}`       |
| `configMaps.plugins.enabled` | প্লাগিন মাউন্ট     | `false`    |
| `configMaps.plugins.data`    | ConfigMap কন্টেন্ট | `{}`       |

### রিসোর্স

| প্যারামিটার                 | বিবরণ            | ডিফল্ট মান |
| --------------------------- | ---------------- | ---------- |
| `resources.requests.cpu`    | CPU রিকোয়েস্ট   | `100m`     |
| `resources.requests.memory` | মেমরি রিকোয়েস্ট | `128Mi`    |
| `resources.limits.cpu`      | CPU সীমা         | `2000m`    |
| `resources.limits.memory`   | মেমরি সীমা       | `2Gi`      |

## কনফিগারেশন উদাহরণ

### মৌলিক উদাহরণ

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### প্রমাণীকরণ সহ উদাহরণ

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Persistence সহ উদাহরণ

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

### Session affinity নিষ্ক্রিয় সহ উদাহরণ

```yaml
affinity:
  enabled: false
```

### Ingress সহ সম্পূর্ণ উদাহরণ

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

একাধিক রেপ্লিকা থাকলে OpenCode সঠিকভাবে কাজ করার জন্য স্টিকি সেশন (session affinity) প্রয়োজন। এটি প্রয়োজনীয় কারণ সার্ভার ক্লায়েন্টের সাথে সংযোগের অবস্থা বজায় রাখে।

### Nginx Ingress

Nginx Ingress এর জন্য, `affinity.enabled: true` হলে স্টিকি সেশন কনফিগারেশন স্বয়ংক্রিয় হয়। chart স্বয়ংক্রিয়ভাবে প্রয়োজনীয় annotations কনফিগার করে:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # অথবা persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Traefik এর জন্য, স্টিকি সেশন middleware কনফিগার করতে ভুলবেন না:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Affinity মোড

- **balanced**: অনুরোধগুলি সমানভাবে উপলব্ধ backends এর মধ্যে বিতরণ করা হয়
- **persistent**: অনুরোধগুলি সম্ভব হলে সবসময় একই backend এ পাঠানো হয়

## ভলিউম

chart নিম্নলিখিত volumes মাউন্ট করে:

| Path                          | বিবরণ                |
| ----------------------------- | -------------------- |
| `/root/.config/opencode`      | কনফিগারেশন ডিরেক্টরি |
| `/root/.cache/opencode`       | opencode ক্যাশ       |
| `/root/.local/share/opencode` | opencode ডেটা        |

## পরিবেশ ভেরিয়েবল

নিম্নলিখিত পরিবেশ ভেরিয়েবলগুলি `env` এর মাধ্যমে কনফিগার করা যায়:

| ভেরিয়েপল               | বিবরণ                | ডিফল্ট মান               |
| ----------------------- | -------------------- | ------------------------ |
| `PORT`                  | সার্ভার পোর্ট        | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | কনফিগারেশন ডিরেক্টরি | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS ডোমেইন          | `local`                  |
| `OPENCODE_MDNS_ENABLED` | mDNS সক্রিয় করুন    | `false`                  |

পরিবেশ ভেরিয়েবল কনফিগারেশন উদাহরণ:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## অতিরিক্ত রিসোর্স

### Autoscaling

HPA (Horizontal Pod Autoscaler) সক্রিয় করা যায়:

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

### অতিরিক্ত ভলিউম

অতিরিক্ত volumes মাউন্ট করতে:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## রোডম্যাপ

- [ ] cert-manager এর সাথে স্বয়ংক্রিয় TLS সাপোর্ট
- [ ] ক্লাউড প্রোভাইডারের জন্য কনফিগারেশন উদাহরণ
- [ ] Prometheus/Grafana এর সাথে মেট্রিক্স ইন্টিগ্রেশন
- [ ] PostgreSQL এর সাথে deployment টেমপ্লেট
- [ ] Helm tests সাপোর্ট

## অবদান

অবদান স্বাগতম! অনুগ্রহ করে [GitHub](https://github.com/anomalyco/opencode) এ PR পাঠান বা issue খুলুন।

## লাইসেন্স

Apache License 2.0 - বিস্তারিত জানার জন্য [LICENSE](LICENSE) দেখুন।
