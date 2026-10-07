# FT001-US003 — Notificar execução

> Feature: FT001 — Consulta de ordens · Tipo: História de usuário · Subclassificação: interface · Definition of Ready: **Pronta com ressalvas**

## Enunciado

**Como** investidor, **quero** acompanhar minhas ordens, **para** decidir com informação.

## Critérios de aceite

- **CA1** — critério 1 de Notificar execução

## Cenários de aceite

Executáveis em `historia.feature` (Gherkin, tags `@CAn`):

- Execução — verifica CA1

## Contratos de interface

Esta história não expõe nem consome interfaces.

## Rastreabilidade

| Artefato | Referências |
|---|---|
| Requisitos | FR-001 |
| Atributos de qualidade |  |
| ADRs (em `docs/adr/`) |  |
| Entidades (DER) |  |
| Contêineres (C4) |  |

## Dependências

| Tipo | Destino | Justificativa |
|---|---|---|
| Depende de | Cancelar ordem |  |

## Lacunas

- canal de notificação não definido

## Ressalvas da Definition of Ready

- Lacuna: canal de notificação não definido
- Depende de “Cancelar ordem”, que ainda não está pronta.
