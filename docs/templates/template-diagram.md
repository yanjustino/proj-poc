# Templates de Diagrama

Use a seção correspondente abaixo para `{DIAGRAM_TYPE}`.

---

> **Convenções de cor C4Model** — inclua as linhas `classDef` relevantes em cada diagrama flowchart:
>
> | Classe | Elemento | Preenchimento (Fill) |
> |---|---|---|
> | `person` | Atores humanos / usuários | `#08427B` (azul escuro) |
> | `system` | Sistemas de software internos | `#1168BD` (azul) |
> | `external` | Sistemas externos / terceiros | `#999999` (cinza) |
> | `container` | Apps, serviços, filas dentro de um sistema | `#438DD5` (azul médio) |
> | `database` | Bancos de dados / armazenamento | `#438DD5` (azul médio) |
> | `component` | Componentes dentro de um contêiner | `#85BBF0` (azul claro, texto escuro) |
> | `step` | Etapas de processo | `#438DD5` (azul médio) |
> | `decision` | Nós de decisão / ramificação | `#85BBF0` (azul claro, texto escuro) |
> | `terminal` | Nós de início / fim | `#1168BD` (azul) |

---

## c4-context

````markdown
---
title: "C4 L1 Contexto de Sistema — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: c4-context
hierarchy_level: Strategic
generated: YYYY-MM-DD
---

# C4 Nível 1: Contexto de Sistema — {WORK_ITEM_TITLE}

## Diagrama

```mermaid
flowchart TB
    classDef person   fill:#08427B,color:#ffffff,stroke:#052E56
    classDef system   fill:#1168BD,color:#ffffff,stroke:#0B4884
    classDef external fill:#999999,color:#ffffff,stroke:#6B6B6B

    P1(["Nome do Ator<br/>[Pessoa]<br/>Descrição da wiki"]):::person
    S1["Nome do Sistema<br/>[Sistema de Software]<br/>Descrição da wiki"]:::system
    E1["Sistema Externo<br/>[Sistema Externo]<br/>Descrição da wiki"]:::external

    P1 -->|"Usa"| S1
    S1 -->|"Chama — protocolo se declarado"| E1
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.
````

## c4-container

````markdown
---
title: "C4 L2 Contêiner — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: c4-container
hierarchy_level: Strategic
generated: YYYY-MM-DD
---

# C4 Nível 2: Contêiner — {WORK_ITEM_TITLE}

## Diagrama

```mermaid
flowchart TB
    classDef person    fill:#08427B,color:#ffffff,stroke:#052E56
    classDef container fill:#438DD5,color:#ffffff,stroke:#2E6295
    classDef database  fill:#438DD5,color:#ffffff,stroke:#2E6295
    classDef external  fill:#999999,color:#ffffff,stroke:#6B6B6B

    P1(["Nome do Ator<br/>[Pessoa]"]):::person
    E1["Sistema Externo<br/>[Sistema Externo]"]:::external

    subgraph boundary["Nome do Sistema"]
        C1["Nome do Contêiner<br/>[Tecnologia]<br/>Descrição"]:::container
        DB1[("Nome do Banco de Dados<br/>[Tecnologia]<br/>O que armazena")]:::database
    end

    style boundary fill:none,stroke:#444444,stroke-dasharray:5 5,color:#444444

    P1  -->|"Usa — HTTPS"| C1
    C1  -->|"Lê/Escreve — SQL"| DB1
    C1  -->|"Chama — REST"| E1
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````

## c4-component

````markdown
---
title: "C4 L3 Componente — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: c4-component
hierarchy_level: Product
generated: YYYY-MM-DD
---

# C4 Nível 3: Componente — {WORK_ITEM_TITLE}

## Diagrama

```mermaid
flowchart TB
    classDef component fill:#85BBF0,color:#000000,stroke:#5D82A8
    classDef container fill:#438DD5,color:#ffffff,stroke:#2E6295
    classDef external  fill:#999999,color:#ffffff,stroke:#6B6B6B

    E1["Contêiner Externo<br/>[Tecnologia]"]:::container

    subgraph boundary["Nome do Contêiner"]
        COMP1["Nome do Componente<br/>[Tecnologia]<br/>Responsabilidade"]:::component
        COMP2["Nome do Componente<br/>[Tecnologia]<br/>Responsabilidade"]:::component
    end

    style boundary fill:none,stroke:#444444,stroke-dasharray:5 5,color:#444444

    E1 -->|"Chama"| COMP1
    COMP1 -->|"Usa"| COMP2
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````
## process-flow

````markdown
---
title: "Fluxo de Processo — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: process-flow
hierarchy_level: Product
generated: YYYY-MM-DD
---

# Fluxo de Processo: {WORK_ITEM_TITLE}

## Diagrama

```mermaid
flowchart TD
    classDef terminal  fill:#1168BD,color:#ffffff,stroke:#0B4884
    classDef step      fill:#438DD5,color:#ffffff,stroke:#2E6295
    classDef decision  fill:#85BBF0,color:#000000,stroke:#5D82A8

    START([Início]):::terminal --> STEP1[Nome da etapa]:::step
    STEP1 --> DEC1{Decisão?}:::decision
    DEC1 -->|Sim| STEP2[Próxima etapa]:::step
    DEC1 -->|Não| STEP3[Etapa alternativa]:::step
    STEP2 --> END([Fim]):::terminal
    STEP3 --> END
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````

## data-flow

````markdown
---
title: "Fluxo de Dados — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: data-flow
hierarchy_level: Product
generated: YYYY-MM-DD
---

# Fluxo de Dados: {WORK_ITEM_TITLE}

## Diagrama

```mermaid
flowchart LR
    classDef external  fill:#999999,color:#ffffff,stroke:#6B6B6B
    classDef step      fill:#438DD5,color:#ffffff,stroke:#2E6295
    classDef database  fill:#438DD5,color:#ffffff,stroke:#2E6295

    SRC(["Origem<br/>[Sistema Externo]"]):::external
    PROC["Processo / Transformação"]:::step
    DEST[("Destino<br/>[Banco de Dados]")]:::database

    SRC  -->|"Elemento de dado"| PROC
    PROC -->|"Dado transformado"| DEST
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````

## sequence

````markdown
---
title: "Diagrama de Sequência — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: sequence
hierarchy_level: Tactical
generated: YYYY-MM-DD
---

# Diagrama de Sequência: {WORK_ITEM_TITLE}

## Diagrama

```mermaid
sequenceDiagram
  actor Usuario as Usuário
  participant ServiceA as Serviço A
  participant ServiceB as Serviço B
  Usuario->>ServiceA: Requisição (dados)
  ServiceA->>ServiceB: Chamada (payload)
  ServiceB-->>ServiceA: Resposta
  ServiceA-->>Usuario: Resposta
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````

## state

````markdown
---
title: "Diagrama de Estado — {WORK_ITEM_TITLE}"
type: artifact
subtype: diagram
diagram_type: state
hierarchy_level: Tactical
generated: YYYY-MM-DD
---

# Diagrama de Estado: {WORK_ITEM_TITLE}

## Diagrama

```mermaid
stateDiagram-v2
  [*] --> NomeDoEstado
  NomeDoEstado --> OutroEstado : evento / condição
  OutroEstado --> [*] : condição terminal
```

## Fontes
Leita em `{AVAILABLE_ARTIFACTS}` e liste os artefatos de fontes relevantes para o diagrama, incluindo links para suas páginas de wiki.

````
