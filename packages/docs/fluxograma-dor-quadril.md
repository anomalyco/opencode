# Fluxograma de Diagnóstico de Dor no Quadril

## Fluxograma Clínico para Avaliação de Dor no Quadril

```mermaid
flowchart TD
    A[Paciente com Dor no Quadril] --> B{Sinais de Alerta<br/>Red Flags?}

    B -->|Sim| C[Red Flags Presentes:<br/>- Trauma significativo<br/>- Febre/calafrios<br/>- Perda de peso inexplicada<br/>- História de câncer<br/>- Dor noturna intensa<br/>- Criança com claudicação<br/>- Uso de corticosteroides]

    C --> D[Investigação Urgente:<br/>- Raio-X pelve e quadril<br/>- Exames laboratoriais<br/>- VHS, PCR, hemograma<br/>- Considerar RM urgente]

    D --> E{Diagnóstico?}

    E -->|Fratura| F[Encaminhar Ortopedia<br/>URGENTE]
    E -->|Artrite Séptica| G[EMERGÊNCIA<br/>Drenagem cirúrgica<br/>Antibioticoterapia]
    E -->|Tumor/Metástase| H[Encaminhar Oncologia/<br/>Ortopedia Oncológica]
    E -->|Necrose Avascular| I[Encaminhar Ortopedia<br/>Considerar descompressão]

    B -->|Não| J{Idade do<br/>paciente?}

    J -->|Criança/Adolescente<br/>menos de 18 anos| K[Considerar causas pediátricas:<br/>- Sinovite transitória<br/>- Doença de Legg-Calvé-Perthes<br/>- Epifisiólise femoral<br/>- Artrite idiopática juvenil]

    K --> L[Raio-X bilateral<br/>Encaminhar Ortopedia<br/>Pediátrica]

    J -->|Adulto<br/>18-50 anos| M{Tipo de dor?}

    M -->|Dor anterior/virilha<br/>Intra-articular| N[Avaliar:<br/>- Teste FADIR positivo<br/>- Teste FABER positivo<br/>- Limitação rotação interna<br/>- Dor ao carregar peso]

    N --> O{Trauma recente<br/>ou esportista?}

    O -->|Sim| P[Suspeita:<br/>- Lesão labral<br/>- Impacto femoroacetabular FAI<br/>- Fratura por estresse]

    P --> Q[Raio-X inicial<br/>Se negativo: RM quadril<br/>com protocolo FAI/labrum]

    Q --> R{RM confirma<br/>lesão?}

    R -->|Sim| S[Encaminhar Ortopedia<br/>Cirurgia quadril<br/>Considerar artroscopia]

    R -->|Não| T[Tratamento conservador:<br/>- Fisioterapia<br/>- Modificação atividades<br/>- AINES<br/>- Fortalecimento core/glúteos]

    O -->|Não| U[Suspeita:<br/>- Osteoartrite precoce<br/>- Displasia acetabular<br/>- Artropatia inflamatória]

    U --> V[Raio-X pelve AP e quadril<br/>Considerar exames reumatológicos]

    V --> W{Artrite<br/>inflamatória?}

    W -->|Sim| X[Encaminhar Reumatologia<br/>Iniciar tratamento específico]

    W -->|Não| Y{Sinais de<br/>osteoartrite?}

    Y -->|Sim leve/moderada| T
    Y -->|Sim grave| S

    M -->|Dor lateral<br/>Extra-articular| Z[Avaliar:<br/>- Dor à palpação trocânter<br/>- Dor ao deitar lado afetado<br/>- Teste de Trendelenburg<br/>- Sinal de Ober]

    Z --> AA[Diagnóstico provável:<br/>- Bursite trocantérica<br/>- Tendinopatia glúteo médio<br/>- Síndrome da banda iliotibial]

    AA --> AB[Tratamento inicial:<br/>- Fisioterapia específica<br/>- AINES tópicos/orais<br/>- Evitar atividades provocativas<br/>- Alongamentos e fortalecimento]

    AB --> AC{Melhora em<br/>6-8 semanas?}

    AC -->|Sim| AD[Continuar fisioterapia<br/>Retorno gradual atividades]

    AC -->|Não| AE[Considerar:<br/>- Infiltração com corticoide<br/>- US ou Raio-X para calcificações<br/>- Encaminhar especialista]

    M -->|Dor posterior<br/>Irradiação| AF[Considerar:<br/>- Dor referida da coluna lombar<br/>- Síndrome do piriforme<br/>- Radiculopatia L2-L3]

    AF --> AG[Avaliar coluna lombar<br/>Teste de elevação da perna<br/>Exame neurológico]

    AG --> AH{Origem coluna<br/>lombar?}

    AH -->|Sim| AI[Seguir protocolo<br/>dor lombar/radicular]
    AH -->|Não| AJ[Tratamento conservador<br/>síndrome piriforme]

    J -->|Idoso<br/>mais de 50 anos| AK[Suspeita principal:<br/>Osteoartrite do quadril]

    AK --> AL[Raio-X pelve AP<br/>e quadril perfil]

    AL --> AM{Osteoartrite<br/>confirmada?}

    AM -->|Sim leve| AN[Tratamento conservador:<br/>- Perda de peso se indicado<br/>- Fisioterapia<br/>- Exercícios low-impact<br/>- Analgésicos/AINES<br/>- Bengala se necessário]

    AM -->|Sim moderada/grave| AO{Limitação funcional<br/>significativa?}

    AO -->|Não| AN
    AO -->|Sim| AP[Encaminhar Ortopedia<br/>Avaliação para artroplastia<br/>total do quadril]

    AM -->|Não| AQ[Investigar outras causas:<br/>- Exames reumatológicos<br/>- RM para partes moles<br/>- Descartar dor referida]

    T --> AR{Reavaliação<br/>8-12 semanas}

    AR -->|Melhora| AD
    AR -->|Sem melhora| AS[RM quadril<br/>Encaminhar especialista]

    AN --> AT{Reavaliação<br/>3-6 meses}

    AT -->|Controlado| AU[Manutenção:<br/>Exercícios regulares<br/>Controle de peso<br/>Acompanhamento anual]

    AT -->|Piora| AP

    style G fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px
    style F fill:#ff8787,stroke:#c92a2a,stroke-width:2px
    style C fill:#ffe066,stroke:#f59f00,stroke-width:2px
    style A fill:#4dabf7,stroke:#1971c2,stroke-width:2px
    style AD fill:#51cf66,stroke:#2f9e44,stroke-width:2px
    style AU fill:#51cf66,stroke:#2f9e44,stroke-width:2px
```

## Legenda

### Cores
- **Azul**: Ponto de entrada (Paciente)
- **Amarelo**: Sinais de alerta (Red Flags)
- **Vermelho escuro**: Emergência médica
- **Vermelho claro**: Urgência (fraturas)
- **Verde**: Alta/Controle adequado

### Principais Considerações

#### Red Flags (Sinais de Alerta)
Indicam possível patologia séria que requer investigação urgente:
- Trauma significativo (queda, acidente automobilístico)
- Sintomas constitucionais (febre, calafrios, perda de peso)
- História de câncer ou uso de corticosteroides
- Dor noturna intensa que acorda o paciente
- Criança/adolescente com claudicação e recusa de apoio
- Idade > 50 anos com início súbito sem trauma
- Fatores de risco para necrose avascular:
  - Uso de corticosteroides, álcool
  - Anemia falciforme
  - Trauma prévio, luxação
  - Quimioterapia, radioterapia

#### Artrite Séptica do Quadril (Emergência)
Requer drenagem cirúrgica urgente:
- Febre alta com dor intensa no quadril
- Incapacidade total de apoio
- Leucocitose significativa
- VHS e PCR muito elevados
- Mais comum em imunossuprimidos, diabéticos, usuários de drogas IV

#### Classificação por Localização da Dor

**Dor Anterior/Virilha (Intra-articular)**:
- Osteoartrite do quadril
- Impacto femoroacetabular (FAI)
- Lesão do labrum acetabular
- Artrite inflamatória
- Necrose avascular

**Dor Lateral (Extra-articular)**:
- Bursite trocantérica (bursite do grande trocânter)
- Tendinopatia do glúteo médio/mínimo
- Síndrome da banda iliotibial
- Fratura por estresse do colo femoral

**Dor Posterior**:
- Dor referida da coluna lombar (L2-L3)
- Síndrome do piriforme
- Sacroileíte
- Patologia da articulação sacroilíaca

#### Exames Físicos Específicos

**Testes para Patologia Intra-articular**:
- **FADIR** (Flexão, ADução, Rotação Interna): positivo em impacto femoroacetabular anterior
- **FABER** (Flexão, ABdução, Rotação Externa): positivo em patologia intra-articular
- **Teste de rotação interna**: limitação sugere osteoartrite
- **Teste de Scour**: dor com compressão e rotação do quadril

**Testes para Patologia Extra-articular**:
- **Teste de Trendelenburg**: fraqueza do glúteo médio
- **Teste de Ober**: contratura da banda iliotibial
- **Palpação do trocânter maior**: bursite trocantérica
- **Teste de elevação da perna estendida**: dor referida da lombar

#### Causas Pediátricas por Faixa Etária

**0-4 anos**:
- Sinovite transitória (mais comum)
- Artrite séptica
- Displasia do desenvolvimento do quadril (DDQ)

**4-10 anos**:
- Doença de Legg-Calvé-Perthes (necrose avascular da cabeça femoral)
- Sinovite transitória

**10-16 anos**:
- Epifisiólise femoral proximal (SCFE)
- Artrite idiopática juvenil

#### Exames de Imagem

**Raio-X**:
- **Sempre** iniciar com raio-X pelve AP e quadril afetado (AP e perfil)
- Pode mostrar: osteoartrite, fraturas, displasia, FAI morfológico
- Comparação bilateral útil em crianças

**Ressonância Magnética (RM)**:
- Indicada quando:
  - Raio-X normal com suspeita clínica alta
  - Suspeita de lesão labral ou FAI
  - Avaliação de partes moles (tendões, bursas)
  - Necrose avascular inicial
  - Tumor ou infecção
- Protocolo específico para FAI/labrum quando indicado

**Ultrassonografia**:
- Útil para:
  - Avaliar derrame articular
  - Guiar aspiração/infiltração
  - Avaliar tendões e bursas (bursite trocantérica)

**Tomografia Computadorizada (TC)**:
- Menos usada rotineiramente
- Útil para planejamento cirúrgico em displasia e FAI

#### Princípios de Tratamento Conservador

**Medidas Gerais**:
1. Modificação de atividades (evitar atividades dolorosas)
2. Controle de peso corporal
3. Uso de bengala no lado contralateral se necessário
4. Calçados adequados com amortecimento

**Medicações**:
- Paracetamol (primeira linha em idosos)
- AINES (uso limitado, cuidado em idosos e com comorbidades)
- Analgésicos tópicos (AINES tópicos para dor extra-articular)
- Evitar opióides para dor crônica

**Fisioterapia**:
- **Bursite trocantérica**: fortalecimento glúteo médio, alongamentos
- **Osteoartrite**: exercícios de amplitude, fortalecimento, aeróbicos de baixo impacto
- **FAI/lesão labral**: fortalecimento core, correção biomecânica
- Exercícios aquáticos (hidroterapia) muito benéficos

**Infiltrações**:
- Bursite trocantérica: corticoide + anestésico local (guiada por US)
- Intra-articular: pode ser diagnóstica e terapêutica
- Evidência limitada para benefício a longo prazo

#### Indicações Cirúrgicas

**Artroscopia do Quadril**:
- Lesão labral sintomática
- Impacto femoroacetabular (FAI) com falha conservador
- Corpos livres intra-articulares
- Sinovite persistente

**Artroplastia Total do Quadril**:
- Osteoartrite grave com:
  - Dor refratária a tratamento conservador
  - Limitação funcional significativa
  - Impacto na qualidade de vida
- Necrose avascular avançada
- Artrite reumatóide grave

**Osteotomia**:
- Displasia acetabular em pacientes jovens
- Preservação articular antes de artrose grave

## Referências

Este fluxograma é baseado em diretrizes clínicas internacionais e consensos para diagnóstico e manejo de dor no quadril, incluindo recomendações de:
- American Academy of Orthopaedic Surgeons (AAOS)
- British Society for Rheumatology
- International Society for Hip Arthroscopy (ISHA)
- National Institute for Health and Care Excellence (NICE)
- Consenso Brasileiro de Quadril (Sociedade Brasileira de Ortopedia e Traumatologia)
