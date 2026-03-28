# Documentación de Docker de OpenCode Server

Esta guía cubre la ejecución de OpenCode en modo servidor dentro de contenedores Docker.

## Introducción

OpenCode Server es un despliegue headless de OpenCode que se ejecuta como un servicio en segundo plano, accesible a través de la API HTTP. La imagen de Docker proporciona un entorno de ejecución completo con todas las herramientas necesarias preinstaladas, siendo ideal para:

- Entornos de desarrollo remoto
- Integración CI/CD
- Instancias compartidas de código para equipos
- Ejecutar OpenCode en servidores sin GUI

## Inicio Rápido

Ejecuta OpenCode Server con una contraseña segura:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Accede al servidor en `http://localhost:3000`.

## Variantes de Imagen

Están disponibles dos variantes de imagen base:

| Variante | Imagen Base        | Tamaño | Caso de Uso                        |
| -------- | ------------------ | ------ | ---------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB | Recomendado para la mayoría        |
| `alpine` | Alpine Edge        | ~200MB | Huella mínima, descarga más rápida |

### Descargar Variantes Específicas

```bash
# Debian (recomendado)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Variables de Entorno

| Variable                   | Predeterminada                | Descripción                                             |
| -------------------------- | ----------------------------- | ------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (ninguna)                     | **Requerida.** Contraseña para autenticación HTTP Basic |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Usuario para autenticación HTTP Basic                   |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Directorio de configuración                             |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Directorio de caché                                     |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Directorio de datos                                     |

### Opciones del Servidor (Banderas CLI)

El servidor acepta estas opciones adicionales al sobrescribir el comando predeterminado:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Banderas        | Predeterminada   | Descripción                               |
| --------------- | ---------------- | ----------------------------------------- |
| `--port`        | `0` (aleatorio)  | Puerto en el que escuchar                 |
| `--hostname`    | `127.0.0.1`      | Hostname al que vincular                  |
| `--mdns`        | `false`          | Habilitar descubrimiento de servicio mDNS |
| `--mdns-domain` | `opencode.local` | Nombre de dominio mDNS personalizado      |
| `--cors`        | `[]`             | Dominios adicionales permitidos por CORS  |

## Montaje de Volúmenes

Monta estos volúmenes para persistir datos y compartir recursos:

### Espacio de Trabajo (Requerido)

```bash
-v /path/to/workspace:/workspace
```

Aquí es donde OpenCode opera en tus archivos de proyecto. Monta tu repositorio de código aquí.

### Claves SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Acceso de solo lectura a claves SSH para clonar repositorios privados.

### Configuración de Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Hereda la identidad de usuario de Git del host.

### Configuración de OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Persiste la configuración de OpenCode entre reinicios del contenedor.

### Caché

```bash
-v opencode_cache:/home/opencode/.cache
```

Caché de paquetes npm, servidores de lenguaje y otras herramientas descargadas.

## Puertos

| Puerto | Protocolo | Descripción                                 |
| ------ | --------- | ------------------------------------------- |
| `3000` | HTTP      | API principal del servidor (predeterminado) |

El puerto puede remapearse mediante la bandera `-p` de Docker:

```bash
-p 8080:3000  # Acceder al servidor en http://localhost:8080
```

## Usuario y Permisos

El contenedor se ejecuta como un usuario no root (`opencode`, UID 1000) por seguridad. Este usuario tiene acceso `sudo` sin contraseña para tareas administrativas:

```bash
# Ejecutar comandos como usuario opencode
docker exec -it opencode-server sudo -u opencode <command>

# Obtener shell como usuario opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Si necesitas acceso root:

```bash
docker exec -it opencode-server /bin/bash
```

## Herramientas Instaladas

La imagen incluye estas herramientas de serie:

| Herramienta       | Descripción                                              |
| ----------------- | -------------------------------------------------------- |
| `opencode`        | CLI de OpenCode                                          |
| `bun`             | Runtime de JavaScript y gestor de paquetes               |
| `bunx`            | Equivalente de Bun a npx (ejecutar paquetes npm)         |
| `uv`              | Gestor de paquetes de Python                             |
| `git`             | Control de versiones                                     |
| `git-lfs`         | Extensión de almacenamiento de archivos grandes para Git |
| `build-essential` | GCC, make y bibliotecas de compilación                   |
| `curl`            | Cliente HTTP                                             |
| `wget`            | Utilidad de descarga de archivos                         |
| `openssh-client`  | Cliente SSH y herramientas de clave                      |
| `xz-utils`        | Utilidades de compresión                                 |

### Usando bun

```bash
# Ejecutar un paquete Node.js
docker exec -it opencode-server bunx create-next-app

# Instalar dependencias
docker exec -it opencode-server bun install
```

### Usando uv

```bash
# Instalar un paquete Python
docker exec -it opencode-server uv pip install pandas

# Ejecutar un script Python
docker exec -it opencode-server uv run script.py
```

### Usando git

```bash
# Clonar un repositorio en el espacio de trabajo
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Verificación de Estado

El contenedor incluye una verificación de estado incorporada que verifica que el servidor esté respondiendo:

```bash
# Verificar estado del contenedor
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

El endpoint de salud devuelve HTTP 200 cuando está sano:

```bash
# Verificación de estado manual
curl -f http://localhost:3000/health
```

Configuración de verificación de estado:

- Intervalo: 30 segundos
- Tiempo de espera: 10 segundos
- Período de inicio: 10 segundos
- Reintentos: 3

## Ejemplo de Docker Compose

Crea un archivo `docker-compose.yml`:

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

Inicia el stack:

```bash
docker-compose up -d
```

## Compilar desde el Código Fuente

Para compilar la imagen del servidor desde el código fuente:

### Clonar el repositorio

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Compilar variante Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Compilar variante Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Ejecutar tu compilación local

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Solución de Problemas

### El servidor no inicia

Verifica los logs:

```bash
docker logs opencode-server
```

Problemas comunes:

- Falta `OPENCODE_SERVER_PASSWORD` - el servidor se niega a iniciar sin autenticación
- Puerto ya en uso - cambia el mapeo de puerto del host

### Autenticación fallida

Asegúrate de que la contraseña coincida exactamente. El servidor usa HTTP Basic Auth:

```bash
# Probar autenticación
curl -u opencode:your_password http://localhost:3000/health
```

### Errores de permisos del espacio de trabajo

Asegúrate de que el directorio montado sea escribible por UID 1000:

```bash
# Corregir propiedad
sudo chown -R 1000:1000 /path/to/workspace
```

### Inicio lento

La primera ejecución descarga servidores de lenguaje y herramientas. Verifica el progreso:

```bash
docker logs -f opencode-server
```

### El contenedor no puede acceder a internet

Verifica la configuración de DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### La verificación de estado falla

Verifica que el servidor realmente esté ejecutándose:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### La clave SSH no funciona

Asegúrate de tener los permisos correctos de la clave dentro del contenedor:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
