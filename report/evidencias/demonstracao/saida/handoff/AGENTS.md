# Instruções para agentes de código — Demonstração IT26019 (sintético)

Este pacote foi gerado pelo Senpai a partir do refinamento do work-item. Ele é a especificação: implemente a partir dele, não reinterprete.

## Como trabalhar uma história

1. Leia `specs/<feature>/<história>/spec.md` — comportamento, critérios de aceite (`CAn`), regras, contratos e rastreabilidade.
2. Siga `tasks.md` **em ordem**. Os testes vêm antes da implementação que cobrem.
3. Os contratos são a fonte da verdade da interface: `openapi.json` (endpoints expostos), `asyncapi.json` (eventos). Não mude um contrato sem registrar a mudança na spec.
4. Os cenários de `historia.feature` (Gherkin, tags `@CAn`) precisam passar — são os testes de aceitação.
5. Respeite as decisões em `docs/adr/` e os contêineres e entidades de `docs/arquitetura.md`.
6. Uma história de API Gateway e a de Backend do mesmo endpoint expõem o mesmo contrato; implemente a de Backend primeiro.
7. Se a pasta da história tem um `radahn.yaml`, o assessment do `plan.md` concluiu que o Radahn (motor low-code de APIs REST configurado por YAML) implementa a história: use esse arquivo como base em vez de escrever código. Ele é um rascunho — revise-o contra os contratos e os critérios de aceite, feche as lacunas listadas no `plan.md` e nunca coloque segredos nele (só `FROM_ENV(NOME)`).
8. Se a pasta da história tem `anexos/`, são complementos que quem refinou anexou para cobrir dependências que a spec pode não refletir por completo (a seção "Complementos anexados" do `spec.md` lista cada um). Leia-os junto com a spec — fazem parte dela.

## O que não fazer

- Toda história do backlog está em `specs/`, pronta ou não — confira a **Definition of Ready** no topo de cada `spec.md`. Se estiver marcada **Não pronta**, leia "Bloqueios da Definition of Ready" antes de implementar: a decisão de seguir mesmo assim é de quem está te orientando, não sua — não implemente uma história bloqueada sem essa confirmação.
- Não invente comportamento fora dos critérios de aceite; lacunas e questões em aberto de cada `spec.md` precisam de resposta de quem refinou.
