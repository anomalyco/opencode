# OPENSACIA Security Agent - Guía de Uso

## Instalación

OPENSACIA requiere Docker instalado y corriendo:

```bash
# Verificar Docker
docker --version

# Descargar imagen Kali (opcional, se descarga automáticamente)
docker pull kalilinux/kali-rolling:latest
```

## Comandos Básicos

### Modo Interactivo

```bash
# Iniciar OPENSACIA en modo interactivo
opencode opensacia

# Especificar modo de automatización
opencode opensacia --mode auto
opencode opensacia --mode assisted
opencode opensacia --mode mixed
```

### Auditoría Directa

```bash
# Escaneo de red
opencode opensacia "Audita la red 192.168.1.0/24" --target 192.168.1.0/24

# Auditoría web
opencode opensacia "Escanea example.com en busca de vulnerabilidades" --target example.com

# Con reporte específico
opencode opensacia "Audita localhost" --report /tmp/audit-report.md
```

## Modos de Automatización

### Auto
Ejecuta todos los comandos sin confirmación. Útil para auditorías no interactivas.

```bash
opencode opensacia "Escaneo completo de 10.0.0.0/24" --mode auto
```

### Assisted
Confirma cada acción antes de ejecutar. Máximo control.

```bash
opencode opensacia "Pentesting de mi servidor web" --mode assisted
```

### Mixed (Default)
Pregunta solo acciones potencialmente destructivas.

```bash
opencode opensacia "Análisis de vulnerabilidades" --mode mixed
```

## Ejemplos de Auditoría

### Web Application Security

```bash
opencode opensacia "
Realiza una auditoría web completa de example.com incluyendo:
- Descubrimiento de subdominios
- Escaneo de puertos web
- Análisis de vulnerabilidades con nuclei
- Fuzzing de directorios
" --target example.com
```

### Network Scanning

```bash
opencode opensacia "
Descubre hosts activos en 192.168.1.0/24 y escanea puertos abiertos.
Luego identifica vulnerabilidades en servicios web encontrados.
" --target 192.168.1.0/24
```

### Active Directory

```bash
opencode opensacia "
Enumera el dominio usando las credenciales proporcionadas.
Identifica configuraciones inseguras y posibles rutas de escalación de privilegios.
" --mode mixed
```

### Code Analysis

```bash
opencode opensacia "
Analiza el código fuente en ./src buscando:
- Hardcoded secrets/API keys
- Vulnerabilidades SQL injection
- Configuraciones inseguras
" --target ./src
```

## Variables de Entorno

```bash
# Imagen de Kali a usar
export OPENSACIA_KALI_IMAGE="kalilinux/kali-rolling:latest"

# Modo de red Docker
export OPENSACIA_DOCKER_NETWORK="host"

# Directorio de reportes
export OPENSACIA_REPORT_PATH="/tmp/opensacia-reports"

# Timeout default (segundos)
export OPENSACIA_DEFAULT_TIMEOUT="300"

# Modo default
export OPENSACIA_DEFAULT_MODE="mixed"

# Auto limpieza de contenedores
export OPENSACIA_AUTO_CLEANUP="true"
```

## Archivo de Configuración

Crea `~/.config/opensacia/config.json`:

```json
{
  "security": {
    "kali": {
      "image": "kalilinux/kali-rolling:latest",
      "network": "host",
      "defaultTimeout": 300
    },
    "reports": {
      "path": "/tmp/opensacia-reports",
      "formats": ["markdown", "json"]
    },
    "modes": {
      "default": "mixed"
    }
  }
}
```

## Salida de Reportes

Los reportes se guardan en `/tmp/opensacia-reports/` por defecto:

```
/tmp/opensacia-reports/
├── 2026-03-05-192.168.1.1.md
├── 2026-03-05-example.com.md
└── 2026-03-05-ad-audit.md
```

## Troubleshooting

### Docker no está corriendo

```bash
# Error: Docker not available
# Solución:
sudo systemctl start docker  # Linux
open -a Docker               # macOS
```

### Contenedores huérfanos

```bash
# Limpiar contenedores kali huérfanos
docker ps -a --filter "name=kali-" -q | xargs docker rm -f
```

### Imagen Kali no disponible

```bash
# Descargar manualmente
docker pull kalilinux/kali-rolling:latest
```

### Permisos insuficientes

```bash
# Asegurar que el usuario está en el grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

## Herramientas Soportadas

El agente Security puede ejecutar cualquier herramienta de Kali Linux:

| Categoría | Herramientas |
|-----------|-------------|
| **Escaneo de Red** | nmap, masscan, rustscan |
| **Web** | nuclei, httpx, nikto, sqlmap, gobuster, ffuf, wfuzz |
| **Password** | john, hashcat, hydra |
| **Active Directory** | bloodhound-python, impacket, crackmapexec |
| **Explotación** | metasploit-framework, searchsploit |
| **Forense** | autopsy, volatility, binwalk |
| **Sniffing** | wireshark, tcpdump, bettercap |

## Uso del Agente Security

Para usar el agente Security directamente en el CLI de opencode:

```bash
# Usar el agente security
opencode run --agent security "Audita 192.168.1.0/24"

# Ver agentes disponibles
opencode agent list
```

## Tests de Integración

Para ejecutar tests que requieren Docker:

```bash
# Solo funciona si Docker está instalado
KALI_TESTS=true bun test --cwd packages/opencode test/security/integration.test.ts
```
