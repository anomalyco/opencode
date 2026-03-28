# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart สำหรับการ deploy OpenCode AI assistant server บน Kubernetes

## คำอธิบาย

Helm chart นี้ติดตั้ง OpenCode AI Assistant server บน Kubernetes cluster OpenCode เป็น AI assistant สำหรับการพัฒนาซอฟต์แวร์ที่สามารถผสานรวมกับ code editors ผ่าน Language Server Protocol (LSP)

## ข้อกำหนดเบื้องต้น

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx หรือ traefik)

## การติดตั้ง

### เพิ่ม repository

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### การติดตั้งพื้นฐาน

```bash
helm install opencode opencode/opencode
```

### การติดตั้งด้วยค่า custom

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### การติดตั้งด้วย values file

```bash
helm install opencode opencode/opencode -f values.yaml
```

## การกำหนดค่า

ดูไฟล์ `values.yaml` สำหรับพารามิเตอร์ทั้งหมดที่สามารถกำหนดค่าได้

### พารามิเตอร์หลัก

| พารามิเตอร์          | คำอธิบาย             | ค่าเริ่มต้น                  |
| -------------------- | -------------------- | ---------------------------- |
| `image.repository`   | Docker Image         | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Image tag            | `dev-alpine`                 |
| `replicaCount`       | จำนวน replicas       | `1`                          |
| `service.type`       | Service type         | `ClusterIP`                  |
| `service.port`       | Service port         | `80`                         |
| `service.targetPort` | Container port       | `4096`                       |
| `server.port`        | Opencode server port | `4096`                       |

### การยืนยันตัวตน

| พารามิเตอร์           | คำอธิบาย                 | ค่าเริ่มต้น |
| --------------------- | ------------------------ | ----------- |
| `auth.enabled`        | เปิดใช้งานการยืนยันตัวตน | `false`     |
| `auth.username`       | Username                 | `opencode`  |
| `auth.password`       | Password                 | `""`        |
| `auth.existingSecret` | Secret ที่มีอยู่         | `""`        |

### Session Affinity

| พารามิเตอร์           | คำอธิบาย                   | ค่าเริ่มต้น        |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | เปิดใช้งาน sticky sessions | `true`             |
| `affinity.cookieName` | Cookie name                | `OPENCODEAFFINITY` |
| `affinity.mode`       | โหมด (balanced/persistent) | `balanced`         |
| `affinity.type`       | ประเภท (cookie)            | `cookie`           |

### Persistence

| พารามิเตอร์                     | คำอธิบาย          | ค่าเริ่มต้น     |
| ------------------------------- | ----------------- | --------------- |
| `persistence.data.enabled`      | PVC สำหรับข้อมูล  | `false`         |
| `persistence.data.storageClass` | StorageClass      | `""`            |
| `persistence.data.accessMode`   | Access mode       | `ReadWriteOnce` |
| `persistence.data.size`         | ขนาด              | `1Gi`           |
| `persistence.cache.enabled`     | PVC สำหรับ cache  | `false`         |
| `persistence.config.enabled`    | PVC สำหรับ config | `false`         |

### ConfigMaps

| พารามิเตอร์                  | คำอธิบาย          | ค่าเริ่มต้น |
| ---------------------------- | ----------------- | ----------- |
| `configMaps.agents.enabled`  | Mount AGENTS.md   | `false`     |
| `configMaps.agents.data`     | ConfigMap content | `{}`        |
| `configMaps.docs.enabled`    | Mount เอกสาร      | `false`     |
| `configMaps.docs.data`       | ConfigMap content | `{}`        |
| `configMaps.plugins.enabled` | Mount plugins     | `false`     |
| `configMaps.plugins.data`    | ConfigMap content | `{}`        |

### ทรัพยากร

| พารามิเตอร์                 | คำอธิบาย       | ค่าเริ่มต้น |
| --------------------------- | -------------- | ----------- |
| `resources.requests.cpu`    | CPU request    | `100m`      |
| `resources.requests.memory` | Memory request | `128Mi`     |
| `resources.limits.cpu`      | CPU limit      | `2000m`     |
| `resources.limits.memory`   | Memory limit   | `2Gi`       |

## ตัวอย่างการกำหนดค่า

### ตัวอย่างพื้นฐาน

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### ตัวอย่างการยืนยันตัวตน

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### ตัวอย่างการใช้งาน persistence

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

### ตัวอย่างการปิดใช้งาน session affinity

```yaml
affinity:
  enabled: false
```

### ตัวอย่างเต็มรูปแบบพร้อม Ingress

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

OpenCode ต้องการ sticky sessions (session affinity) เพื่อทำงานอย่างถูกต้องเมื่อมีหลาย replicas นี่เป็นสิ่งจำเป็นเพราะ server รักษา state ของการเชื่อมต่อกับ client

### Nginx Ingress

สำหรับ Nginx Ingress การกำหนดค่า sticky sessions จะเป็นแบบอัตโนมัติเมื่อ `affinity.enabled: true` Chart กำหนดค่า annotations ที่จำเป็นโดยอัตโนมัติ:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # หรือ persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

สำหรับ Traefik ต้องแน่ใจว่าได้กำหนดค่า middleware สำหรับ sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### โหมด Affinity

- **balanced**: คำขอถูกกระจายอย่างเท่าเทียมกันระหว่าง backends ที่มีอยู่
- **persistent**: คำขอถูกส่งไปยัง backend เดิมเสมอเมื่อเป็นไปได้

## Volumes

Chart ติดตั้ง volumes ดังต่อไปนี้:

| Path                          | คำอธิบาย             |
| ----------------------------- | -------------------- |
| `/root/.config/opencode`      | ไดเรกทอรีการกำหนดค่า |
| `/root/.cache/opencode`       | Cache ของ opencode   |
| `/root/.local/share/opencode` | ข้อมูลของ opencode   |

## ตัวแปรสภาพแวดล้อม

ตัวแปรสภาพแวดล้อมต่อไปนี้สามารถกำหนดค่าได้ผ่าน `env`:

| ตัวแปร                  | คำอธิบาย             | ค่าเริ่มต้น              |
| ----------------------- | -------------------- | ------------------------ |
| `PORT`                  | Server port          | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | ไดเรกทอรีการกำหนดค่า | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS domain          | `local`                  |
| `OPENCODE_MDNS_ENABLED` | เปิดใช้งาน mDNS      | `false`                  |

ตัวอย่างการกำหนดค่าตัวแปรสภาพแวดล้อม:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## ทรัพยากรเพิ่มเติม

### Autoscaling

HPA (Horizontal Pod Autoscaler) สามารถเปิดใช้งานได้:

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

สำหรับการติดตั้ง volumes เพิ่มเติม:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] รองรับ TLS อัตโนมัติด้วย cert-manager
- [ ] ตัวอย่างการกำหนดค่าสำหรับ cloud providers
- [ ] การผสานรวมกับ Prometheus/Grafana สำหรับ metrics
- [ ] Templates สำหรับ deployment กับ PostgreSQL
- [ ] รองรับ Helm tests

## การมีส่วนร่วม

ยินดีต้อนรับการมีส่วนร่วม! กรุณาส่ง PR หรือเปิด issue ที่ [GitHub](https://github.com/anomalyco/opencode)

## สัญญาอนุญาต

Apache License 2.0 - ดู [LICENSE](LICENSE) สำหรับรายละเอียด
