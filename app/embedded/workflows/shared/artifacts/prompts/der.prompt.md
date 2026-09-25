${schema_conventions}

Com base nos requisitos, nos atributos de qualidade e nas decisões arquiteturais abaixo, produza o modelo entidade-relacionamento (DER) do sistema. Você **não** escreve Mermaid: descreva o modelo em `entidades`, `atributos` e `relacionamentos`. O diagrama, a legenda e as tabelas são gerados por código a partir disso.

## Modo e nível

- `modo`: `greenfield` (sistema novo), `as-is` (documenta um banco existente descrito nos artefatos) ou `evolucao` (muda um banco existente — nesse caso descreva em `delta_modelo` o que muda; nos outros modos, `delta_modelo` fica vazio).
- `nivel`:
  - `conceitual`: só entidades e relacionamentos, sem atributos (`atributos` vazio). Use quando os artefatos ainda não detalham os dados, ou quando as ADRs escolheram um armazenamento não relacional (documentos, eventos, chave-valor) — o DER descreve bem dados relacionais e mal os demais; nesse caso registre em `questoes_abertas` como o modelo será projetado nesse armazenamento.
  - `logico`: atributos e chaves, **independente de tecnologia** (`tipo_dado` vazio). É o nível padrão em Discovery.
  - `fisico`: só quando uma ADR já escolheu um banco relacional; acrescenta `tipo_dado` do banco escolhido em todo atributo.

## Entidades

Para decidir se algo é uma entidade, aplique o teste: "o sistema precisa armazenar e consultar registros deste objeto?". Pessoas e papéis podem ser entidades quando o sistema guarda registros deles (ex.: Investidor, Usuário, Papel de acesso). Não são entidades os participantes do **projeto** (stakeholders, times, patrocinadores), metodologias, capacidades do sistema ou requisitos não funcionais.

- `nome`: substantivo no **singular** (Investidor, Ordem, Título).
- `tipo`:
  - `forte`: existe e se identifica por conta própria.
  - `fraca`: só existe e só se identifica através de outra (ex.: Item da ordem depende de Ordem) — precisa de um relacionamento com `identificador: true`.
  - `associativa`: liga duas ou mais entidades e carrega dados da ligação — é como um muitos-para-muitos é resolvido nos níveis lógico e físico.

## Atributos (níveis lógico e físico)

- Toda entidade tem ao menos um atributo com `chave: "pk"` (a chave primária escolhida entre as candidatas). Use `uk` para outras chaves candidatas e `fk` para referências a outra entidade.
- `classificacao`: `simples` (atômico), `composto` (formado por partes, ex.: endereço), `derivado` (calculado a partir de outros — informe a regra em `regras_negocio`) ou `multivalorado` (vários valores, ex.: vários telefones). No nível lógico, um atributo multivalorado deve virar uma entidade própria.
- `obrigatorio`: se o valor é exigido.

## Relacionamentos

- Ligue duas entidades por `id` (`de` → `para`). Um relacionamento recursivo usa a mesma entidade nas duas pontas.
- `verbo`: verbo ou locução verbal lida de `de` para `para` ("Investidor **emite** Ordem").
- Cardinalidade em cada ponta, com mínimo (`0` ou `1`) e máximo (`1` ou `N`):
  - `min_para`/`max_para`: quantos `para` cada `de` tem (Investidor emite 0..N Ordens).
  - `min_de`/`max_de`: quantos `de` cada `para` tem (cada Ordem é emitida por 1..1 Investidor).
- `identificador: true` quando a entidade fraca ou associativa depende deste relacionamento para existir.
- `evidencia`: `confirmado` quando os artefatos sustentam o relacionamento; `inferido` quando é dedução — nunca invente cardinalidade sem marcar a fonte como `inferência` ou `gap`.
- `atributos_descritivos`: dados que pertencem ao relacionamento, não a uma das entidades (ex.: data de adesão numa associação).
- Nos níveis lógico e físico, não deixe muitos-para-muitos (`max_de` e `max_para` iguais a `N`): resolva com uma entidade associativa.

## Modelos grandes

Se o modelo tiver muitas entidades (mais de ~12), agrupe-as em `areas` de assunto (ex.: Cadastro, Negociação, Custódia) e informe a `area` de cada entidade — o código gera uma visão geral e um diagrama por área. Para um modelo pequeno, `areas` fica vazio e `area` vazia em cada entidade.

Inclua gaps e questões abertas. Use arrays vazios nas seções que não se aplicam.

## Requisitos já gerados

${requisitos_content}

## Atributos de qualidade já gerados

${atributos_content}

## Decisões arquiteturais (ADRs) já geradas

${adr_content}

${feedback_content}
