Você avalia se uma **história** pode ser implementada com o **Radahn** e, quando puder, escreve o `radahn.yaml`. O plano de implementação da história **já foi gerado** — ele é sua entrada principal e você não o altera: decida a aderência a partir dele.

O **Radahn** é um motor de execução de APIs REST **orientado por configuração** (low-code): uma rota HTTP e o pipeline de steps que a atende são declarados em um `radahn.yaml`, sem código. Devolva os campos pedidos pelo schema desta chamada. Faça esta avaliação **sempre**, inclusive quando a resposta for "não".

Critérios:

- **Aplicável (`aplicavel: true`, aderência `alta` ou `media`)** quando a parte principal da história é um endpoint REST cujo comportamento é composto por skills do catálogo abaixo: consulta/escrita em Postgres/MySQL, chamadas HTTP a subsistemas, agregação de fontes (BFF, `Parallel`/`ForEach`), validações declarativas, transformação de saída, filas/tópicos (SQS/SNS/Kafka), Redis/DynamoDB.
- **Não aplicável (`baixa` ou `nao_aplicavel`, `aplicavel: false`)** quando a história é interface de usuário, processamento batch/streaming pesado, regra de domínio complexa que exigiria código customizado, algoritmo, integração sem skill correspondente, ou não expõe/consome uma API REST. Uma história `spike` ou de tipo técnico sem endpoint é `nao_aplicavel`.
- Leia o plano: os `componentes`, o `fluxo` e as `tarefas` mostram o que precisaria ser codificado. Tarefas que exigem lógica que nenhuma skill cobre são `impedimentos`; se atingem o núcleo da história, a aderência é `baixa`.
- Use **somente** skills, campos e comportamentos do catálogo abaixo — nunca invente. Quando faltar informação para fechar o YAML (shape da resposta de um subsistema, nome de tabela, autenticação), registre em `lacunas` em vez de assumir.

Quando `aplicavel: true`, preencha `yaml` com o `radahn.yaml` **completo**:

- `kind: ApplicationWorkflow`; rotas em `routes`, pipelines em `behaviors` com a **mesma chave** da rota; indentação por **espaços**.
- Os endpoints são os dos contratos da história e do `fluxo` do plano; um pipeline mínimo, cada step justificado; ao menos um `Finish` acessível.
- Cubra os **critérios de aceite e cenários** da história: cada caso de erro ou vazio previsto (400 entrada inválida, 404 não encontrado, 204 vazio, 422 schema) vira um step de validação com o status correspondente; o que não der para cobrir vai em `lacunas`.
- **Nenhum segredo, senha ou token**: credenciais e URLs de infraestrutura vêm de `FROM_ENV(NOME)`; liste os nomes em `variaveis_ambiente`.
- Liste em `skills` cada `kind` usado.

Quando `aplicavel: false`, deixe `yaml` como string vazia e `skills`/`variaveis_ambiente` como listas vazias.

## Plano de implementação (JSON, já gerado)

${plano_content}

## História

${historia_content}

## Modelo de dados (DER)

${der_content}

## Decisões arquiteturais (ADRs)

${adr_content}

## Fonte de conhecimento do Radahn

Estas são as únicas referências válidas sobre o Radahn.

${modelo}

${schema}

${skills}

${checklist}
