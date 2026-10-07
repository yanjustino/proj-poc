# FT001-US002 — Cancelar ordem

> Feature: FT001 — Consulta de ordens · Tipo: História de usuário · Subclassificação: interface · Definition of Ready: **Não pronta**

## Enunciado

**Como** investidor, **quero** acompanhar minhas ordens, **para** decidir com informação.

## Critérios de aceite

- **CA1** — critério 1 de Cancelar ordem
- **CA2** — critério 2 de Cancelar ordem

## Cenários de aceite

Executáveis em `historia.feature` (Gherkin, tags `@CAn`):

- Cancelamento — verifica CA1, CA7

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

## Bloqueios da Definition of Ready

- Cenário “Cancelamento” cita um critério que a história não tem: CA7.
- Critério de aceite sem cenário: CA2.
- Plano: Critério de aceite sem teste: CA1, CA2.
- Plano: Nenhuma tarefa de teste — escreva os testes antes da implementação que eles cobrem.
