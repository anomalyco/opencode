# Fluxograma de Diagnóstico de Dor Lombar

## Fluxograma Clínico para Avaliação de Dor Lombar

```mermaid
flowchart TD
    A[Paciente com Dor Lombar] --> B{Sinais de Alerta<br/>Red Flags?}

    B -->|Sim| C[Red Flags Presentes:<br/>- Trauma significativo<br/>- Febre/calafrios<br/>- Perda de peso inexplicada<br/>- História de câncer<br/>- Déficit neurológico progressivo<br/>- Incontinência<br/>- Anestesia em sela]

    C --> D[Investigação Urgente:<br/>- Raio-X<br/>- RM ou TC<br/>- Exames laboratoriais]

    D --> E{Diagnóstico?}

    E -->|Fratura| F[Encaminhar Ortopedia/<br/>Neurocirurgia]
    E -->|Infecção/Tumor| G[Encaminhar Especialista<br/>Apropriado]
    E -->|Síndrome Cauda Equina| H[EMERGÊNCIA<br/>Neurocirurgia Imediata]

    B -->|Não| I{Dor radicular<br/>com déficit motor?}

    I -->|Sim| J[Avaliar distribuição:<br/>- Teste de elevação da perna<br/>- Exame neurológico<br/>- Reflexos e força muscular]

    J --> K{Déficit motor<br/>significativo?}

    K -->|Sim| L[RM coluna lombossacra<br/>Considerar encaminhamento<br/>para cirurgia]

    K -->|Não| M[Tratamento conservador:<br/>- Fisioterapia<br/>- Analgésicos/AINES<br/>- Educação do paciente]

    I -->|Não| N{Duração dos<br/>sintomas?}

    N -->|Aguda<br/>menos de 4 semanas| O[Dor Lombar Aguda<br/>Inespecífica]

    O --> P[Manejo inicial:<br/>- Manter atividade<br/>- Analgésicos simples<br/>- Evitar repouso prolongado<br/>- Educação: prognóstico favorável]

    P --> Q{Melhora em<br/>4-6 semanas?}

    Q -->|Sim| R[Alta com orientações<br/>prevenção de recorrência]

    Q -->|Não| S[Reavaliar e considerar:<br/>- Fisioterapia estruturada<br/>- Avaliação psicossocial<br/>- Exames de imagem se indicado]

    N -->|Subaguda<br/>4-12 semanas| T[Dor Lombar Subaguda]

    T --> U[Intensificar tratamento:<br/>- Fisioterapia ativa<br/>- Terapia cognitivo-comportamental<br/>- Avaliar fatores ocupacionais<br/>- Medicação otimizada]

    U --> V{Melhora?}

    V -->|Sim| R
    V -->|Não| W[Considerar imagem<br/>e encaminhamento especializado]

    N -->|Crônica<br/>mais de 12 semanas| X[Dor Lombar Crônica]

    X --> Y[Abordagem multidisciplinar:<br/>- Fisioterapia intensiva<br/>- Programa de exercícios<br/>- Avaliação psicológica<br/>- Manejo da dor crônica<br/>- Considerar imagem se não feita]

    Y --> Z{Resposta ao<br/>tratamento?}

    Z -->|Inadequada| AA[Encaminhar para:<br/>- Clínica da dor<br/>- Reumatologia<br/>- Cirurgia coluna se indicado]

    Z -->|Adequada| AB[Manutenção:<br/>- Programa exercícios domiciliar<br/>- Acompanhamento periódico<br/>- Prevenção de recaídas]

    M --> AC{Reavaliação<br/>4-6 semanas}
    AC -->|Melhora| R
    AC -->|Sem melhora| L

    L --> AD[Considerar:<br/>- Infiltração epidural<br/>- Cirurgia se hérnia<br/>compressiva significativa]

    S --> AE{Exames revelam<br/>patologia específica?}
    AE -->|Sim| AF[Tratar causa específica]
    AE -->|Não| U

    W --> AG{Patologia<br/>identificada?}
    AG -->|Sim| AF
    AG -->|Não| Y

    style H fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px
    style C fill:#ffe066,stroke:#f59f00,stroke-width:2px
    style A fill:#4dabf7,stroke:#1971c2,stroke-width:2px
    style R fill:#51cf66,stroke:#2f9e44,stroke-width:2px
    style AB fill:#51cf66,stroke:#2f9e44,stroke-width:2px
```

## Legenda

### Cores
- **Azul**: Ponto de entrada (Paciente)
- **Amarelo**: Sinais de alerta (Red Flags)
- **Vermelho**: Emergência médica
- **Verde**: Alta/Resultado positivo

### Principais Considerações

#### Red Flags (Sinais de Alerta)
Indicam possível patologia séria que requer investigação urgente:
- Trauma significativo (queda, acidente)
- Sintomas constitucionais (febre, calafrios, perda de peso)
- História de câncer
- Uso prolongado de corticosteroides
- Idade > 50 anos (primeira apresentação) ou < 20 anos
- Dor que piora ao deitar ou dor noturna intensa
- Déficit neurológico progressivo ou extenso
- Incontinência urinária ou fecal de início recente
- Anestesia em sela
- Deformidade estrutural

#### Síndrome Cauda Equina (Emergência)
Requer encaminhamento neurocirúrgico imediato:
- Retenção urinária aguda
- Incontinência fecal
- Anestesia em sela bilateral
- Déficit motor bilateral em membros inferiores

#### Classificação Temporal
- **Aguda**: < 4 semanas
- **Subaguda**: 4-12 semanas
- **Crônica**: > 12 semanas

#### Princípios de Tratamento
1. **Dor aguda**: Manter atividade, evitar repouso prolongado
2. **Dor subaguda**: Intensificar fisioterapia e abordar fatores psicossociais
3. **Dor crônica**: Abordagem multidisciplinar com foco em funcionalidade

#### Exames de Imagem
- **Não** indicados rotineiramente na dor lombar inespecífica aguda
- Considerar quando:
  - Red flags presentes
  - Déficit neurológico
  - Falta de melhora após 4-6 semanas de tratamento conservador
  - Antes de considerar intervenção invasiva

## Referências

Este fluxograma é baseado em diretrizes clínicas internacionais para manejo de dor lombar, incluindo recomendações de:
- American College of Physicians (ACP)
- National Institute for Health and Care Excellence (NICE)
- North American Spine Society (NASS)
