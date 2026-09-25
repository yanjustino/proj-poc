${schema_conventions}

Com base nos requisitos, nos atributos de qualidade e nas decisões arquiteturais abaixo, produza os diagramas de arquitetura do sistema. Tipos disponíveis: `c4-context`, `c4-container`, `c4-component`, `c4-deployment`, `process-flow`, `data-flow`, `sequence` e `state`.

**Produza sempre um `c4-context` e um `c4-container`** — o modelo C4 recomenda os dois para todo sistema. Os demais tipos são opcionais: inclua-os apenas quando houver evidência nos artefatos que justifique o diagrama.

## Como descrever um diagrama C4

Para os tipos `c4-*`, você **não** escreve Mermaid (`diagrama_mermaid` fica vazio): descreva o modelo em `escopo`, `elementos` e `relacoes`. O desenho, a legenda e as cores são gerados por código a partir disso.

- Cada elemento tem um `id` curto e único no diagrama, um `nome`, um `tipo`, a `tecnologia` (quando o nível pede), uma `descricao` de uma frase com a responsabilidade dele e as `fontes`.
- Cada relação liga dois elementos por `id` (`de` → `para`) e tem uma `descricao` com verbo que diga o que a origem faz com o destino (ex.: "Envia pedidos para", "Lê e grava dados de clientes em"), mais `tecnologia` quando o nível pede.
- Inclua somente elementos **diretamente conectados** ao escopo: todo elemento precisa aparecer em ao menos uma relação.
- Use os **mesmos nomes** entre os níveis: as pessoas e os sistemas externos do diagrama de contêiner são os mesmos do contexto; o contêiner em escopo de um diagrama de componente é um contêiner do diagrama de contêiner.
- Tecnologia que não esteja nos artefatos abaixo (em especial nas ADRs) deve ser citada como `gap` em vez de inventada. Uma dedução razoável usa `inferência`.

### `c4-context` — contexto de sistema

- Escopo: **um** sistema de software (`escopo.nome` é o nome dele).
- Elementos: exatamente **um** `sistema` (o sistema em escopo), mais as `pessoa` (usuários, papéis, personas) e os `sistema_externo` com que ele interage diretamente — sistemas que normalmente estão fora da responsabilidade do time.
- **Sem tecnologia, protocolo ou detalhe de implementação**: `tecnologia` vazia em todos os elementos e relações. É o diagrama para mostrar a pessoas não técnicas.
- Não mostre contêineres, componentes nem infraestrutura.

### `c4-container` — contêineres

- Escopo: o mesmo sistema de software do contexto. Ele é a **fronteira** do diagrama, não um elemento (não use o tipo `sistema` aqui).
- Elementos principais: os contêineres dentro do sistema — `container` para uma aplicação (API, aplicação web, SPA, app mobile, worker, função) e `banco_dados` para um armazenamento de dados (banco, schema, bucket, fila persistida). Cada um **com tecnologia**.
- Elementos de apoio: as pessoas e os sistemas externos diretamente conectados aos contêineres.
- Relações entre contêineres **com tecnologia/protocolo** (ex.: HTTPS/JSON, gRPC, JDBC, AMQP).
- **Não mostre implantação**: cluster, balanceador de carga, replicação, failover, região, Kubernetes/EKS e afins variam por ambiente e pertencem a um `c4-deployment`.

### `c4-component` — componentes (opcional)

- Só produza se agregar valor real ao entendimento — em Discovery normalmente ainda não há código, então prefira não gerar, a menos que requisitos, atributos ou ADRs já determinem a decomposição interna de um contêiner.
- Escopo: **um único contêiner** (`escopo.nome` igual ao nome dele no diagrama de contêiner). Um diagrama por contêiner.
- Elementos principais: os `componente` dentro desse contêiner, cada um com responsabilidade e tecnologia/implementação. Elementos de apoio: outros contêineres do mesmo sistema, pessoas e sistemas externos ligados diretamente aos componentes.

### `c4-deployment` — implantação (opcional)

- Só produza se atributos de qualidade ou ADRs definirem a infraestrutura. Um diagrama **por ambiente** (preencha `ambiente`, ex.: "Produção").
- Elementos: `no_implantacao` (nuvem, região, cluster, máquina, serviço gerenciado — com a tecnologia) e as instâncias dos contêineres do diagrama de contêiner, com `no_pai` apontando para o nó onde rodam. Nós podem ser aninhados via `no_pai`.

### Campos que não se aplicam

Fora do tipo em que são pedidos, use string vazia (`tecnologia`, `no_pai`, `ambiente`) ou array vazio. Nos tipos que não são C4, `escopo` tem nome e descrição vazios, `elementos` e `relacoes` são arrays vazios.

## Demais tipos (`process-flow`, `data-flow`, `sequence`, `state`)

Escreva o Mermaid em `diagrama_mermaid`: `flowchart` para processo e dados, `sequenceDiagram` para sequência e `stateDiagram-v2` para estado.

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

${feedback_content}
