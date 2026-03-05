# OPENSACIA - Claude Code Instructions

## OPENSACIA Security Agent

OPENSACIA incluye un agente especializado en ciberseguridad que ejecuta herramientas de Kali Linux en contenedores Docker.

### Comando principal

```bash
opencode opensacia "tu prompt de auditoría"
```

### Modos de operación

- `--mode auto`: Completamente autónomo
- `--mode assisted`: Confirma cada acción
- `--mode mixed`: Pregunta solo acciones destructivas (default)

### Herramientas disponibles

El agente puede ejecutar cualquier herramienta de Kali:
- Red: nmap, masscan, rustscan
- Web: nuclei, httpx, nikto, sqlmap, gobuster
- Password: john, hashcat, hydra
- AD: bloodhound-python, impacket, crackmapexec

### Requisitos

- Docker instalado y corriendo
- Imagen `kalilinux/kali-rolling:latest` (se descarga automáticamente)

### Ejemplos de uso

```bash
# Auditoría web
opencode opensacia "Audita example.com" --target example.com

# Escaneo de red
opencode opensacia "Escanea 192.168.1.0/24" --mode auto

# Con reporte
opencode opensacia "Audita mi servidor" --report /tmp/audit.md
```

### Variables de entorno

- `OPENSACIA_KALI_IMAGE`: Imagen de Kali (default: kalilinux/kali-rolling:latest)
- `OPENSACIA_DOCKER_NETWORK`: Red Docker (default: host)
- `OPENSACIA_REPORT_PATH`: Directorio de reportes (default: /tmp/opensacia-reports)
- `OPENSACIA_DEFAULT_TIMEOUT`: Timeout en segundos (default: 300)
- `OPENSACIA_DEFAULT_MODE`: Modo default (default: mixed)

Más información en `docs/security/usage.md`
