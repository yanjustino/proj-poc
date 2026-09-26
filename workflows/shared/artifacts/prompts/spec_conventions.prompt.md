## A história como especificação para desenvolvimento

Esta história é o ponto de partida de quem vai codificá-la. Além do comportamento, ela precisa dizer **o que sustenta** a entrega e **qual interface** será construída.

### Rastreabilidade (`rastreabilidade`)

Liste os identificadores **exatos**, como aparecem nos artefatos abaixo, daquilo que esta história atende ou toca:

- `requisitos`: IDs dos requisitos atendidos (ex.: `FR-003`, `IR-001`, `RN-002`). Toda história de usuário atende ao menos um requisito.
- `atributos`: IDs de atributos de qualidade e restrições que a implementação precisa respeitar (ex.: `NFR-001`, `AC-002`).
- `adrs`: ADRs cujas decisões a implementação deve seguir (ex.: `ADR-002`).
- `entidades`: nomes das entidades do DER que a história lê ou altera.
- `conteineres`: nomes dos contêineres do diagrama C4 que a história altera.

Só cite o que existe nos artefatos fornecidos — uma referência inexistente é apontada como erro na revisão. Use arrays vazios quando não houver.

### Contratos de interface (`contratos`)

Descreva a interface de forma estruturada — o OpenAPI e o AsyncAPI são gerados a partir disto:

- `endpoints`: cada operação HTTP que a história expõe, com `metodo`, `caminho` (parâmetros de caminho entre chaves, ex.: `/ordens/{id}`, cada um declarado em `parametros` com `local: "path"`), `autenticacao` (conforme ADRs e atributos de segurança), `parametros`, `corpo` (vazio em GET/DELETE) e `respostas` (ao menos uma de sucesso 2xx e os erros previstos pelas regras, cada uma com seus `campos`).
- `eventos`: cada mensagem que a história publica ou consome, com `direcao`, `canal` e o payload em `campos`.
- `integracoes`: cada API de sistema externo que a história **chama** (chamada de saída): `sistema` (nome ou id exato do diagrama C4), `operacao`, `protocolo`, `requisicao`, `resposta` e como tratar `falhas` (timeout, indisponibilidade, resposta inválida — conforme as ADRs de resiliência).
- Use nomes de campos coerentes com os atributos das entidades do DER e as tecnologias das ADRs.
- Uma história de API Gateway descreve o endpoint exposto ao cliente; a de Backend, o endpoint com a lógica. **O par expõe exatamente os mesmos endpoints** (mesmo método e caminho, payloads compatíveis) — um endpoint interno do backend que o gateway não expõe precisa ser justificado em `fora_escopo`. Um worker descreve o evento que consome e o que publica.
- **Integração de saída não se divide em Gateway/Backend**: quando o sistema chama um sistema externo, é uma única história de backend com o contrato em `integracoes`. A separação Gateway/Backend vale só para endpoints que o sistema **expõe**.
- História sem interface (ex.: uma migração interna ou um spike) deixa `endpoints` e `eventos` vazios. Não invente endpoints sem evidência: cite `gap` em `contratos_fontes` e registre a dúvida em `questoes_abertas`.

### Cenários de aceite (`cenarios`)

Escreva cada cenário estruturado — o Gherkin é gerado a partir disto: `titulo`, `dado` (pré-condições), `quando` (ação) e `entao` (resultado verificável), cada um como uma lista de passos sem a palavra-chave (o primeiro vira "Dado/Quando/Então", os seguintes "E"). Em `criterios`, liste os critérios de aceite que o cenário verifica — `CA1` é o primeiro item de `criterios_aceite`, `CA2` o segundo — e garanta que **todo critério tenha ao menos um cenário**, incluindo os caminhos de erro previstos pelas regras.

### Dependências e mudanças

- `dependencias_impedimentos`: cada dependência com `tipo` (`depende_de`: esta história precisa do destino antes; `bloqueia`: o destino precisa desta; `relacionada`; `impedimento_externo`: acesso, contrato, time ou sistema fora do backlog), `destino` (o **título exato** de outra história deste lote, o **código** de uma feature (ex.: `FT010` — não o título), o ID de um requisito ou o nome do sistema/time externo) e a justificativa em `texto`. A história de API Gateway **depende da** de Backend do mesmo endpoint (`depende_de`, destino = título exato da de Backend); a de Backend **não** depende da de Gateway — isso criaria um ciclo.
- `regras_negocio` e `dependencias_impedimentos` indicam em `mudanca` se o item é `novo`, `modificado`, `as_is` (já existe e só é referenciado) ou `removido`.
- Um critério não funcional (criptografia, auditoria, desempenho, disponibilidade) também precisa de um cenário **verificável**: o `entao` descreve o que se observa (ex.: "o dado gravado no banco está cifrado", "um evento de auditoria com usuário e horário é registrado", "a resposta chega em menos de 2 s em 95% das requisições"). Se não houver como verificá-lo num cenário desta história, ele não é um critério de aceite dela: mova-o para `definition_of_done`.
