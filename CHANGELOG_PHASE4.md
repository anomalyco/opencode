# OPENSACIA Phase 4 - Security Agent

## Resumen

Phase 4 transforma OPENSACIA en un agente de ciberseguridad autónomo capaz de ejecutar herramientas de Kali Linux en contenedores Docker.

## Componentes Nuevos

### Core
- **KaliContainer Manager**: Gestión de contenedores Docker efímeros y persistentes
- **KaliTool**: Tool genérico para ejecutar cualquier comando de Kali Linux
- **Security Agent**: Agente especializado en ciberseguridad
- **Parsers**: NmapParser, NucleiParser para análisis de output
- **ReportGenerator**: Generación de reportes profesionales en markdown

### CLI
- Comando `opencode opensacia` con selección de modo de automatización
- Opciones: `--mode`, `--target`, `--report`

### Configuración
- Variables de entorno OPENSACIA_*
- Config file en `~/.config/opensacia/config.json`

## Modos de Operación

1. **Auto**: Ejecución completamente autónoma
2. **Assisted**: Confirmación de cada acción
3. **Mixed**: Preguntas solo para acciones destructivas (default)

## Herramientas Soportadas

- Red: nmap, masscan, rustscan
- Web: nuclei, httpx, nikto, sqlmap, gobuster, ffuf, wfuzz
- Password: john, hashcat, hydra
- Active Directory: bloodhound-python, impacket, crackmapexec
- Explotación: metasploit-framework, searchsploit

## Uso Básico

```bash
# Modo interactivo
opencode opensacia

# Auditoría directa
opencode opensacia "Audita 192.168.1.0/24" --target 192.168.1.0/24 --mode auto
```

## Requisitos

- Docker instalado y corriendo
- Imagen `kalilinux/kali-rolling:latest` (descarga automática)

## Archivos Creados

```
packages/opencode/src/
├── security/
│   ├── kali/
│   │   ├── container.ts    # KaliContainer manager
│   │   ├── parser.ts       # NucleiParser, NmapParser
│   │   └── report.ts       # ReportGenerator
│   └── index.ts
├── tool/
│   └── kali.ts             # KaliTool
├── agent/
│   ├── agent.ts            # Security agent definition
│   └── prompt/
│       └── security.txt    # System prompt
├── cli/
│   └── cmd/
│       └── opensacia.ts    # Opensacia CLI command
└── flag/
    └── flag.ts             # OPENSACIA_* flags

test/
├── security/
│   └── kali/
│       ├── container.test.ts
│       ├── parser.test.ts
│       └── integration.test.ts
└── tool/
    └── kali.test.ts

docs/
├── security/
│   └── usage.md
└── plans/
    └── 2026-03-05-opensacia-phase4-security-implementation.md
```

## Testing

```bash
# Unit tests
bun test --cwd packages/opencode test/security/

# Integration tests (requiere Docker)
KALI_TESTS=true bun test --cwd packages/opencode test/security/integration.test.ts
```

## Commits Realizados

1. `c97582fda` feat(phase4): add security directory structure
2. `f3bfdcec0` feat(phase4): add KaliContainer manager with tests
3. `ad8e30554` feat(phase4): add KaliTool for executing Kali Linux tools in Docker
4. `87ee1229c` feat(phase4): add security agent definition
5. `0e7f3e20b` feat(phase4): add security agent system prompt
6. `c57be9766` feat(phase4): add opensacia CLI command
7. `f499019c8` feat(phase4): add NmapParser for parsing nmap output
8. `88d5baddd` feat(phase4): add NucleiParser for parsing nuclei output
9. `dd309bed6` feat(phase4): add ReportGenerator for security audit reports
10. `4822f3446` feat(phase4): add OPENSACIA environment flags
11. `ee33295f5` feat(phase4): ensure report directory exists
12. `0592beea1` feat(phase4): add integration tests for Kali tools
13. `739b3639f` docs(phase4): add security agent usage guide
14. `a995fdc1c` docs(phase4): document security agent in CLAUDE.md
15. `efa8d7a8f` test(phase4): fix afterAll import in integration tests

## Siguiente Fase

Phase 5: Integración con pipelines de GitLab CI/CD para auditorías automáticas en commits y MRs.
