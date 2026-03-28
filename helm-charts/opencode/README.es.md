# OpenCode Helm Chart

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Helm Version](https://img.shields.io/badge/Helm-3+-blue.svg)](https://helm.sh/)
[![Artifact Hub](https://img.shields.io/badge/Artifact%20Hub-opencode-brightgreen.svg)](https://artifacthub.io/packages/helm/opencode/opencode)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg)](https://github.com/anomalyco/opencode/releases)

Helm chart para desplegar el servidor Asistente AI de OpenCode en Kubernetes.

## Descripción

Este chart Helm instala el servidor OpenCode AI Assistant en un cluster de Kubernetes. OpenCode es un asistente de IA para desarrollo de software que puede ser integrado con editores de código a través del Language Server Protocol (LSP).

## Pre-requisitos

- Kubernetes 1.19+
- Helm 3+
- Ingress controller (nginx o traefik)

## Instalación

### Agregar el repositorio

```bash
helm repo add opencode https://anomalyco.github.io/opencode
helm repo update
```

### Instalación básica

```bash
helm install opencode opencode/opencode
```

### Instalación con valores personalizados

```bash
helm install opencode opencode/opencode --set image.tag=latest
```

### Instalación con values file

```bash
helm install opencode opencode/opencode -f values.yaml
```

## Configuración

Consulte el archivo `values.yaml` para ver todos los parámetros configurables.

### Parámetros Principales

| Parámetro            | Descripción                  | Valor por Defecto            |
| -------------------- | ---------------------------- | ---------------------------- |
| `image.repository`   | Imagen Docker                | `ghcr.io/anomalyco/opencode` |
| `image.tag`          | Tag de la imagen             | `dev-alpine`                 |
| `replicaCount`       | Número de réplicas           | `1`                          |
| `service.type`       | Tipo de servicio             | `ClusterIP`                  |
| `service.port`       | Puerto del servicio          | `80`                         |
| `service.targetPort` | Puerto del contenedor        | `4096`                       |
| `server.port`        | Puerto del servidor opencode | `4096`                       |

### Autenticación

| Parámetro             | Descripción             | Valor por Defecto |
| --------------------- | ----------------------- | ----------------- |
| `auth.enabled`        | Habilitar autenticación | `false`           |
| `auth.username`       | Usuario                 | `opencode`        |
| `auth.password`       | Contraseña              | `""`              |
| `auth.existingSecret` | Secret existente        | `""`              |

### Session Affinity

| Parámetro             | Descripción                | Valor por Defecto  |
| --------------------- | -------------------------- | ------------------ |
| `affinity.enabled`    | Habilitar sticky sessions  | `true`             |
| `affinity.cookieName` | Nombre de la cookie        | `OPENCODEAFFINITY` |
| `affinity.mode`       | Modo (balanced/persistent) | `balanced`         |
| `affinity.type`       | Tipo (cookie)              | `cookie`           |

### Persistencia

| Parámetro                       | Descripción     | Valor por Defecto |
| ------------------------------- | --------------- | ----------------- |
| `persistence.data.enabled`      | PVC para datos  | `false`           |
| `persistence.data.storageClass` | StorageClass    | `""`              |
| `persistence.data.accessMode`   | Modo de acceso  | `ReadWriteOnce`   |
| `persistence.data.size`         | Tamaño          | `1Gi`             |
| `persistence.cache.enabled`     | PVC para cache  | `false`           |
| `persistence.config.enabled`    | PVC para config | `false`           |

### ConfigMaps

| Parámetro                    | Descripción             | Valor por Defecto |
| ---------------------------- | ----------------------- | ----------------- |
| `configMaps.agents.enabled`  | Montar AGENTS.md        | `false`           |
| `configMaps.agents.data`     | Contenido del ConfigMap | `{}`              |
| `configMaps.docs.enabled`    | Montar documentación    | `false`           |
| `configMaps.docs.data`       | Contenido del ConfigMap | `{}`              |
| `configMaps.plugins.enabled` | Montar plugins          | `false`           |
| `configMaps.plugins.data`    | Contenido del ConfigMap | `{}`              |

### Recursos

| Parámetro                   | Descripción          | Valor por Defecto |
| --------------------------- | -------------------- | ----------------- |
| `resources.requests.cpu`    | Solicitud de CPU     | `100m`            |
| `resources.requests.memory` | Solicitud de memoria | `128Mi`           |
| `resources.limits.cpu`      | Límite de CPU        | `2000m`           |
| `resources.limits.memory`   | Límite de memoria    | `2Gi`             |

## Ejemplos de Configuración

### Ejemplo básico

```yaml
image:
  tag: latest

replicaCount: 1

service:
  type: ClusterIP
  port: 80
```

### Ejemplo con autenticación

```yaml
auth:
  enabled: true
  username: admin
  password: mysecretpassword
```

### Ejemplo con persistencia

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

### Ejemplo con session affinity deshabilitada

```yaml
affinity:
  enabled: false
```

### Ejemplo completo con Ingress

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

OpenCode requiere sticky sessions (session affinity) para funcionar correctamente cuando hay múltiples réplicas. Esto es necesario porque el servidor mantiene estado de la conexión con el cliente.

### Nginx Ingress

Para Nginx Ingress, la configuración de sticky sessions es automática cuando `affinity.enabled: true`. El chart configura automáticamente las anotaciones necesarias:

```yaml
annotations:
  nginx.ingress.kubernetes.io/affinity: cookie
  nginx.ingress.kubernetes.io/affinity-mode: balanced # o persistent
  nginx.ingress.kubernetes.io/session-cookie-name: OPENCODEAFFINITY
```

### Traefik

Para Traefik, asegurese de configurar el middleware de sticky sessions:

```yaml
annotations:
  traefik.ingress.kubernetes.io/affinity: "true"
```

### Modos de Affinity

- **balanced**: Las solicitudes son distribuidas igualmente entre los backends disponibles
- **persistent**: Las solicitudes son dirigidas siempre al mismo backend cuando es posible

## Volúmenes

El chart monta los siguientes volúmenes:

| Path                          | Descripción                 |
| ----------------------------- | --------------------------- |
| `/root/.config/opencode`      | Directorio de configuración |
| `/root/.cache/opencode`       | Cache de opencode           |
| `/root/.local/share/opencode` | Datos de opencode           |

## Variables de Entorno

Las siguientes variables de entorno pueden ser configuradas vía `env`:

| Variable                | Descripción                 | Valor por Defecto        |
| ----------------------- | --------------------------- | ------------------------ |
| `PORT`                  | Puerto del servidor         | `4096`                   |
| `OPENCODE_CONFIG_DIR`   | Directorio de configuración | `/root/.config/opencode` |
| `OPENCODE_MDNS_DOMAIN`  | Dominio mDNS                | `local`                  |
| `OPENCODE_MDNS_ENABLED` | Habilitar mDNS              | `false`                  |

Ejemplo de configuración de variables de entorno:

```yaml
env:
  PORT: "4096"
  OPENCODE_MDNS_ENABLED: "false"
  OPENCODE_CONFIG_DIR: "/root/.config/opencode"
```

## Recursos Adicionales

### Autoscaling

El HPA (Horizontal Pod Autoscaler) puede ser habilitado:

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

### Volúmenes Extra

Para montar volúmenes adicionales:

```yaml
extraVolumes:
  - name: config
    configMap:
      name: opencode-config
```

## Roadmap

- [ ] Soporte a TLS automático con cert-manager
- [ ] Ejemplos de configuración para proveedores de cloud
- [ ] Integración con Prometheus/Grafana para métricas
- [ ] Templates para deployment con PostgreSQL
- [ ] Soporte a Helm tests

## Contribución

¡Contribuciones son bienvenidas! Por favor, envíe un PR o abra una issue en [GitHub](https://github.com/anomalyco/opencode).

## Licencia

Apache License 2.0 - vea [LICENSE](LICENSE) para detalles.
