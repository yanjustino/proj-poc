${schema_conventions}

Com base no modelo arquitetural aprovado, nos requisitos, nos atributos de qualidade e nas decisões arquiteturais abaixo, produza os diagramas **opcionais** de arquitetura do sistema. Tipos disponíveis: `c4-component`, `c4-deployment`, `process-flow`, `data-flow`, `sequence` e `state`.

**Os diagramas de contexto (`c4-context`) e de contêiner (`c4-container`) não são seus**: eles são o modelo arquitetural abaixo, que uma pessoa já revisou e aprovou. Não os produza. Inclua um diagrama opcional apenas quando houver evidência nos artefatos que o justifique; uma lista vazia é uma resposta válida.

## O modelo arquitetural é o vocabulário fixo

- Pessoas, sistemas externos, contêineres e bancos de dados que aparecem em qualquer diagrama são **os do diagrama de contêiner do modelo** (`conteineres`), com o **mesmo `id` e o mesmo `nome`** — nunca renomeie, funda ou desdobre um elemento do modelo.
- Não crie pessoa, sistema externo ou contêiner que não esteja no modelo. Se um diagrama precisar de um, deixe-o de fora e registre a lacuna na `descricao` do diagrama citando `gap`.
- Use as tecnologias que o modelo dá a cada contêiner.

## Como descrever um diagrama C4

Para os tipos `c4-*`, você **não** escreve Mermaid (`diagrama_mermaid` fica vazio): descreva o modelo em `escopo`, `elementos` e `relacoes`. O desenho, a legenda e as cores são gerados por código a partir disso.

- Cada elemento tem um `id` curto e único no diagrama, um `nome`, um `tipo`, a `tecnologia` (quando o nível pede), uma `descricao` e as `fontes`.
- Cada relação liga dois elementos por `id` (`de` → `para`) e tem uma `descricao` com verbo que diga o que a origem faz com o destino (ex.: "Envia pedidos para", "Lê e grava dados de clientes em"), mais `tecnologia` quando o nível pede.
- **Textos curtos — eles aparecem dentro das caixas e setas do desenho**: `nome` com poucas palavras, `descricao` do elemento em uma frase de até ~80 caracteres, `tecnologia` só com o nome (até ~30 caracteres), `descricao` da relação com até ~45 caracteres. Tecnologia ou protocolo desconhecido: deixe `tecnologia` **vazia** e cite `gap` nas `fontes`.
- Inclua somente elementos **diretamente conectados** ao escopo: todo elemento precisa aparecer em ao menos uma relação.
- Tecnologia que não esteja nos artefatos abaixo (em especial nas ADRs e no modelo) deve ser citada como `gap` em vez de inventada. Uma dedução razoável usa `inferência`.

### `c4-component` — componentes (opcional)

- Não gere `c4-component` para um contêiner que já tem visão de componentes no modelo (`detalhes` com `tipo: "c4-component"`): ela é editada pelo usuário e substitui a sua.
- Só produza se agregar valor real ao entendimento — em Discovery normalmente ainda não há código, então prefira não gerar, a menos que requisitos, atributos ou ADRs já determinem a decomposição interna de um contêiner.
- Escopo: **um único contêiner do modelo** (`escopo.nome` igual ao `nome` dele em `conteineres`). Um diagrama por contêiner.
- Elementos principais: os `componente` dentro desse contêiner, cada um com responsabilidade e tecnologia/implementação. Elementos de apoio: outros contêineres do mesmo sistema, pessoas e sistemas externos ligados diretamente aos componentes — todos do modelo, com o mesmo `id` e `nome`.

### `c4-deployment` — implantação

- **Obrigatório quando uma ADR ou um atributo de qualidade definir infraestrutura** (nuvem, cluster, região, zonas, ambientes) — as histórias de infraestrutura e os planos referenciam esses nós. Um diagrama **por ambiente** (preencha `ambiente`; ao menos "Produção"). Sem nenhuma definição de infraestrutura, não produza.
- Elementos: `no_implantacao` (nuvem, região, cluster, máquina, serviço gerenciado — com a tecnologia) e as instâncias dos contêineres do modelo (mesmo `id`, `nome` e `tecnologia`), com `no_pai` apontando para o nó onde rodam. Nós podem ser aninhados via `no_pai`.

### Campos que não se aplicam

Fora do tipo em que são pedidos, use string vazia (`tecnologia`, `no_pai`, `ambiente`) ou array vazio. Nos tipos que não são C4, `escopo` tem nome e descrição vazios, `elementos` e `relacoes` são arrays vazios.

## Demais tipos (`process-flow`, `data-flow`, `sequence`, `state`)

Escreva o Mermaid em `diagrama_mermaid`: `flowchart` para processo e dados, `sequenceDiagram` para sequência e `stateDiagram-v2` para estado. Participantes e nós que representam um elemento do modelo usam o `nome` dele.

## Modelo arquitetural aprovado

${modelo_content}

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

${feedback_content}
