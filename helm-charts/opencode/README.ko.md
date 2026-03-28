# OpenCode Helm 차트

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Kubernetes에 OpenCode AI 어시스턴트 서버를 배포하기 위한 Helm 차트입니다.

## 설명

이 Helm 차트는 Kubernetes 클러스터에 OpenCode AI Assistant 서버를 설치합니다. OpenCode는 Language Server Protocol(LSP)을 통해 코드 편집기와 통합할 수 있는 소프트웨어 개발용 AI 어시스턴트입니다.

## 필수 조건

- Kubernetes 1.19+
- Helm 3+
- Ingress 컨트롤러 (nginx 또는 traefik)

## 설치

### 저장소 추가

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### 기본 설치

```bash
helm install opencode opencode/opencode
```

### 사용자 정의 값으로 설치

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### values 파일로 설치

```bash
helm install opencode opencode/opencode -f values.yaml
```

## 설정

모든 설정 가능한 매개변수는 `values.yaml` 파일을 참조하세요.

### 주요 매개변수

| 매개변수             | 설명               | 기본값                       |
| -------------------- | ------------------ | ---------------------------- |
| `image.repository`   | Docker 이미지      | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | 이미지 태그        | `dev-alpine`                 |
| `replicaCount`       | 레플리카 수        | `1`                          |
| `service.type`       | 서비스 타입        | `ClusterIP`                  |
| `service.port`       | 서비스 포트        | `80`                         |
| `service.targetPort` | 컨테이너 포트      | `4096`                       |
| `server.port`        | opencode 서버 포트 | `4096`                       |

### 인증

| 매개변수              | 설명        | 기본값     |
| --------------------- | ----------- | ---------- |
| `auth.enabled`        | 인증 활성화 | `false`    |
| `auth.username`       | 사용자 이름 | `opencode` |
| `auth.password`       | 비밀번호    | `""`       |
| `auth.existingSecret` | 기존 시크릿 | `""`       |

### 세션 어피니티

| 매개변수              | 설명                       | 기본값             |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | 스티키 세션 활성화         | `true`             |
| `affinity.cookieName` | 쿠키 이름                  | `OPENCODEAFFINITY` |
| `affinity.mode`       | 모드 (balanced/persistent) | `balanced`         |
| `affinity.type`       | 타입 (cookie)              | `cookie`           |

### 영구 볼륨

| 매개변수                        | 설명         | 기본값          |
| ------------------------------- | ------------ | --------------- |
| `persistence.data.enabled`      | 데이터 PVC   | `false`         |
| `persistence.data.storageClass` | StorageClass | `""`            |
| `persistence.data.accessMode`   | 접근 모드    | `ReadWriteOnce` |
| `persistence.data.size`         | 크기         | `1Gi`           |
| `persistence.cache.enabled`     | 캐시 PVC     | `false`         |
| `persistence.config.enabled`    | 설정 PVC     | `false`         |

### ConfigMaps

| 매개변수                     | 설명             | 기본값  |
| ---------------------------- | ---------------- | ------- |
| `configMaps.agents.enabled`  | AGENTS.md 마운트 | `false` |
| `configMaps.agents.data`     | ConfigMap 내용   | `{}`    |
| `configMaps.docs.enabled`    | 문서 마운트      | `false` |
| `configMaps.docs.data`       | ConfigMap 내용   | `{}`    |
| `configMaps.plugins.enabled` | 플러그인 마운트  | `false` |
| `configMaps.plugins.data`    | ConfigMap 내용   | `{}`    |

### 리소스

| 매개변수                    | 설명        | 기본값  |
| --------------------------- | ----------- | ------- |
| `resources.requests.cpu`    | CPU 요청    | `100m`  |
| `resources.requests.memory` | 메모리 요청 | `128Mi` |
| `resources.limits.cpu`      | CPU 제한    | `2000m` |
| `resources.limits.memory`   | 메모리 제한 | `2Gi`   |

## 설정 예시

### 기본 예시

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### 인증이 있는 예시

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### 영구 볼륨이 있는 예시

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

### 세션 어피니티 비활성화 예시

```yaml
affinity:
  enabled: false
```

### Ingress가 있는 전체 예시

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

## 세션 어피니티

OpenCode는 여러 레플리카가 있을 때 올바르게 작동하기 위해 스티키 세션(세션 어피니티)이 필요합니다. 이는 서버가 클라이언트와의 연결 상태를 유지하기 때문입니다.

### Nginx Ingress

Nginx Ingress의 경우, `affinity.enabled: true`일 때 스티키 세션 구성이 자동으로 적용됩니다. 차트는 필요한 주석을 자동으로 구성합니다:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # 또는 persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Traefik의 경우, 스티키 세션 미들웨어를 구성했는지 확인하세요:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### 어피니티 모드

- **balanced**: 요청이 사용 가능한 백엔드에 균등하게 분배됩니다
- **persistent**: 가능한 경우 요청이 항상 동일한 백엔드로 라우팅됩니다

## 볼륨

차트는 다음 볼륨을 마운트합니다:

| 경로                          | 설명            |
| ----------------------------- | --------------- |
| `/root/.config/opencode`      | 설정 디렉토리   |
| `/root/.cache/opencode`       | opencode 캐시   |
| `/root/.local/share/opencode` | opencode 데이터 |

## 환경 변수

다음 환경 변수는 `env`를 통해 구성할 수 있습니다:

| 변수                    | 설명          | 기본값                   |
| ----------------------- | ------------- | ------------------------ |
| `PORT`                  | 서버 포트     | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | 설정 디렉토리 | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | mDNS 도메인   | `local`                  |
| `OPENCODE_MDNS_ENABLED` | mDNS 활성화   | `false`                  |

환경 변수 설정 예시:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## 추가 기능

### 오토스케일링

HPA(Horizontal Pod Autoscaler)를 활성화할 수 있습니다:

```yaml
autoscaling:
  enabled: true
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### 보안 컨텍스트

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: false
  runAsNonRoot: false
  runAsUser: 0
```

### 추가 볼륨

추가 볼륨을 마운트하려면:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## 로드맵

- [ ] cert-manager를 통한 자동 TLS 지원
- [ ] 클라우드 공급자 설정 예시
- [ ] Prometheus/Grafana 메트릭 통합
- [ ] PostgreSQL 배포 템플릿
- [ ] Helm 테스트 지원

## 기여

기여는 언제나 환영입니다! [GitHub](https://github.com/anomalyco/opencode)에서 PR을 보내거나 이슈를 열어주세요.

## 라이선스

Apache License 2.0 - 자세한 내용은 [LICENSE](LICENSE)를 참조하세요.
