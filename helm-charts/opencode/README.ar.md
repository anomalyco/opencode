# مخطط Helm الخاص بـ OpenCode

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

مخطط Helm لنشر خادم مساعد OpenCode AI على Kubernetes.

## الوصف

يقوم هذا المخطط بتثبيت خادم مساعد OpenCode AI على مجموعة Kubernetes. OpenCode هو مساعد ذكاء اصطناعي لتطوير البرمجيات يمكن دمجه مع محررات الكود عبر بروتوكول خادم اللغة (LSP).

## المتطلبات المسبقة

- Kubernetes 1.19+
- Helm 3+
- متحكم Ingress (nginx أو traefik)

## التثبيت

### إضافة المستودع

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### التثبيت الأساسي

```bash
helm install opencode opencode/opencode
```

### التثبيت مع قيم مخصصة

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### التثبيت مع ملف القيم

```bash
helm install opencode opencode/opencode -f values.yaml
```

## التكوين

راجع ملف `values.yaml` لمعرفة جميع المعلمات القابلة للتكوين.

### المعلمات الرئيسية

| المعلمة              | الوصف              | القيمة الافتراضية            |
| -------------------- | ------------------ | ---------------------------- |
| `image.repository`   | صورة Docker        | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | وسم الصورة         | `dev-alpine`                 |
| `replicaCount`       | عدد النسخ          | `1`                          |
| `service.type`       | نوع الخدمة         | `ClusterIP`                  |
| `service.port`       | منفذ الخدمة        | `80`                         |
| `service.targetPort` | منفذ الحاوية       | `4096`                       |
| `server.port`        | منفذ خادم opencode | `4096`                       |

### المصادقة

| المعلمة               | الوصف          | القيمة الافتراضية |
| --------------------- | -------------- | ----------------- |
| `auth.enabled`        | تمكين المصادقة | `false`           |
| `auth.username`       | اسم المستخدم   | `opencode`        |
| `auth.password`       | كلمة المرور    | `""`              |
| `auth.existingSecret` | السرExisting   | `""`              |

### Session Affinity

| المعلمة               | الوصف                       | القيمة الافتراضية  |
| --------------------- | --------------------------- | ------------------ |
| `affinity.enabled`    | تمكين الجلسات الثابتة       | `true`             |
| `affinity.cookieName` | اسم الكوكي                  | `OPENCODEAFFINITY` |
| `affinity.mode`       | الوضع (balanced/persistent) | `balanced`         |
| `affinity.type`       | النوع (cookie)              | `cookie`           |

### الاستمرارية

| المعلمة                         | الوصف              | القيمة الافتراضية |
| ------------------------------- | ------------------ | ----------------- |
| `persistence.data.enabled`      | PVC للبيانات       | `false`           |
| `persistence.data.storageClass` | StorageClass       | `""`              |
| `persistence.data.accessMode`   | وضع الوصول         | `ReadWriteOnce`   |
| `persistence.data.size`         | الحجم              | `1Gi`             |
| `persistence.cache.enabled`     | PVC للتخزين المؤقت | `false`           |
| `persistence.config.enabled`    | PVC للتكوين        | `false`           |

### ConfigMaps

| المعلمة                      | الوصف           | القيمة الافتراضية |
| ---------------------------- | --------------- | ----------------- |
| `configMaps.agents.enabled`  | تحميل AGENTS.md | `false`           |
| `configMaps.agents.data`     | محتوى ConfigMap | `{}`              |
| `configMaps.docs.enabled`    | تحميل التوثيق   | `false`           |
| `configMaps.docs.data`       | محتوى ConfigMap | `{}`              |
| `configMaps.plugins.enabled` | تحميل الإضافات  | `false`           |
| `configMaps.plugins.data`    | محتوى ConfigMap | `{}`              |

### الموارد

| المعلمة                     | الوصف       | القيمة الافتراضية |
| --------------------------- | ----------- | ----------------- |
| `resources.requests.cpu`    | طلب CPU     | `100m`            |
| `resources.requests.memory` | طلب الذاكرة | `128Mi`           |
| `resources.limits.cpu`      | حد CPU      | `2000m`           |
| `resources.limits.memory`   | حد الذاكرة  | `2Gi`             |

## أمثلة التكوين

### مثال أساسي

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### مثال مع المصادقة

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### مثال مع الاستمرارية

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

### مثال مع تعطيل Session Affinity

```yaml
affinity:
  enabled: false
```

### مثال كامل مع Ingress

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

يتطلب OpenCode الجلسات الثابتة (session affinity) للعمل بشكل صحيح عند وجود نسخ متعددة. هذا ضروري لأن الخادم يحافظ على حالة الاتصال بالعميل.

### Nginx Ingress

لـ Nginx Ingress، يتم تكوين الجلسات الثابتة تلقائيًا عند `affinity.enabled: true`. يقوم المخطط تلقائيًا بتكوين التعليقات التوضيحية اللازمة:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # أو persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

لـ Traefik، تأكد من تكوين middleware الجلسات الثابتة:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### أوضاع Affinity

- **balanced**: يتم توزيع الطلبات بالتساوي على الخلفيات المتاحة
- **persistent**: يتم توجيه الطلبات دائمًا إلى نفس الخلفية عندما يكون ذلك ممكنًا

## الأقراص

يقوم المخطط بتحميل الأقراص التالية:

| المسار                        | الوصف                      |
| ----------------------------- | -------------------------- |
| `/root/.config/opencode`      | دليل التكوين               |
| `/root/.cache/opencode`       | التخزين المؤقت لـ opencode |
| `/root/.local/share/opencode` | بيانات opencode            |

## متغيرات البيئة

يمكن تكوين متغيرات البيئة التالية عبر `env`:

| المتغير                 | الوصف        | القيمة الافتراضية        |
| ----------------------- | ------------ | ------------------------ |
| `PORT`                  | منفذ الخادم  | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | دليل التكوين | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | مجال mDNS    | `local`                  |
| `OPENCODE_MDNS_ENABLED` | تمكين mDNS   | `false`                  |

مثال على تكوين متغيرات البيئة:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## موارد إضافية

###Autoscaling

يمكن تمكين HPA (Horizontal Pod Autoscaler):

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

### أقراص إضافية

لتحميل أقراص إضافية:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## خارطة الطريق

- [ ] دعم TLS التلقائي مع cert-manager
- [ ] أمثلة تكوين لمزودي السحابة
- [ ] تكامل مع Prometheus/Grafana للمقاييس
- [ ] قوالب للنشر مع PostgreSQL
- [ ] دعم اختبارات Helm

## المساهمة

المسورات مرحب بها! يرجى إرسال PR أو فتح issue على [GitHub](https://github.com/anomalyco/opencode).

## الترخيص

رخصة Apache 2.0 - راجع [LICENSE](LICENSE) للتفاصيل.
