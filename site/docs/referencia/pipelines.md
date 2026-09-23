---
sidebar_position: 1
title: Pipelines de artefatos
description: Ordem e dependências dos documentos gerados pelo Senpai.
---

# Pipelines de artefatos

O mapa do Senpai espelha as dependências validadas pelos workflows. Um documento só fica disponível quando suas entradas obrigatórias foram aprovadas.

## Oportunidade · Discovery

| Ordem | Artefato | Depende de |
| ---: | --- | --- |
| 1 | Brief | — |
| 2 | Atributos de qualidade | Brief |
| 3 | Requisitos | Brief |
| 4 | ADRs | Requisitos + atributos |
| 5 | DER | Requisitos + atributos |
| 6 | Diagramas | Requisitos + atributos |
| 7 | Features | Requisitos + ADRs + diagramas |
| 8 | Dependências entre features | Features |
| 9 | Histórias por feature | Feature correspondente |

O DER, quando existe, pode enriquecer as Features, mas não as bloqueia.

## Feature · Delivery

| Ordem | Artefato | Depende de |
| ---: | --- | --- |
| 1 | Brief | opcional |
| 2 | Requisitos | — |
| 3 | ADRs | Requisitos |
| 4 | DER | Requisitos |
| 5 | Diagramas | Requisitos |
| 6 | Detalhamento da Feature | Requisitos |
| 7 | Histórias | Feature detalhada |

Brief e requisitos podem ser iniciados independentemente. ADRs, DER e diagramas complementam o contexto, mas o artefato final exige apenas os requisitos no gate obrigatório atual.

## História · Delivery

| Ordem | Artefato | Depende de |
| ---: | --- | --- |
| 1 | Brief | opcional |
| 2 | Requisitos | — |
| 3 | ADRs | Requisitos |
| 4 | DER | Requisitos |
| 5 | Diagramas | Requisitos |
| 6 | Detalhamento da História | Requisitos |

:::note Fonte de verdade
Quando o workflow e esta página divergirem, a validação implementada nos arquivos `workflows/discovery/` e `workflows/delivery/` é a fonte de verdade. Atualize a documentação junto com qualquer mudança de dependência.
:::
