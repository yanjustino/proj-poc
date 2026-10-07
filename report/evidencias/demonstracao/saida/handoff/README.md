# Demonstração IT26019 (sintético) — pacote de handoff

Gerado pelo Senpai. 2 de 4 história(s) prontas para desenvolvimento — as demais estão aqui também, marcadas como não prontas; a decisão de implementar mesmo assim é de quem lê. Veja `AGENTS.md` para como usar este pacote.

## Histórias

| História | Feature | Definition of Ready | Radahn | Pasta |
|---|---|---|---|---|
| Consultar ordem | FT001-consulta | Pronta | — | `specs/FT001-consulta/US001-consultar-ordem` |
| Cancelar ordem | FT001-consulta | Não pronta | — | `specs/FT001-consulta/US002-cancelar-ordem` |
| Notificar execução | FT001-consulta | Pronta com ressalvas | — | `specs/FT001-consulta/US003-notificar-execucao` |
| Exportar extrato | FT001-consulta | Não pronta | — | `specs/FT001-consulta/US004-exportar-extrato` |

## Bloqueios das histórias não prontas

- **Cancelar ordem** (FT001-consulta): Cenário “Cancelamento” cita um critério que a história não tem: CA7.; Critério de aceite sem cenário: CA2.; Plano: Critério de aceite sem teste: CA1, CA2.; Plano: Nenhuma tarefa de teste — escreva os testes antes da implementação que eles cobrem.
- **Exportar extrato** (FT001-consulta): Sem plano de implementação.

## Documentação

- `docs/arquitetura.md` — diagramas C4 e modelo de dados
- `docs/adr/` — decisões arquiteturais
