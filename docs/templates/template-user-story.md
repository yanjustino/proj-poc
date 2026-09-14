---
title: "{story.id} — {WORK_ITEM_TITLE}"
type: artifact
subtype: user-story
feature_id: "{SELECTED_FEATURE_ID}"
story_id: {story.id}
work_item_type: "{story.work_item_type}"
story_type: "{story.story_type}"
subclassification: "{story.subclassification}"
nature: "{story.nature}"
specialty: "{story.specialty}"
hierarchy_level: Tactical
persona: "{story.persona}"
generated: YYYY-MM-DD
sources_read: N
---

# User Story: {story.action short title}

> Como um(a) **{story.persona}**,
> Eu quero **{story.action}**,  
> Para que **{story.benefit}**.  

## Atributos
- **ID**: {story.id}
- **Tipo de Item de Trabalho**: {story.work_item_type}
- **Tipo de História**: {story.story_type}
- **Subclassificação**: {story.subclassification}
- **Natureza**: {story.nature}
- **Especialidade**: {story.specialty}

## Contexto de Negócio
<!-- descreva o contexto de negócio que justifica a história. -->
...

## Critérios de Aceite
<!-- liste os critérios de aceite da história. -->
| # | Critério | Fonte |
|---|----------|-------|
| AC-1 | ... | [slug]({WIKI_REL_DIR}/sources/slug.md) |

## Cenários Gherkin
<!-- descreva os cenários de teste da história em Gherkin. -->

```gherkin
Funcionalidade: {story.action short title}
  Cenario: ...
    Dado ...
    Quando ...
    Entao ...
```

## Regras de Negócio

| # | Regra | Fonte |
|---|-------|-------|
| BR-1 | ... | [slug]({WIKI_REL_DIR}/sources/slug.md) |

## Definição de Pronto (Definition of Done)

- [ ] ...

## Dependências e Impedimentos

| Tipo | Item | Status | Fonte |
|------|------|--------|-------|
| ... | ... | ... | [slug]({WIKI_REL_DIR}/sources/slug.md) |

## Fora de Escopo

- ...

## Exemplo de Uso (Use Case)
<!-- Optional: quando necessário, descreva exemplos com snippets de código ou fluxos de uso. -->

```<language>
<code snippet>
```
...

## Contratos de Interface (Interface Contracts)
<!-- Optional: quando necessário, descreva contratos de interface com exemplos de payloads, endpoints,
  protocolos, etc. -->
  
```json
<code snippet>
```


## Questões em Aberto

- [ ] ...

## Fontes (Sources)

- [sources]({WIKI_REL_DIR}/sources/slug.md)
- [concepts]({WIKI_REL_DIR}/concepts/slug.md)
- [entities]({WIKI_REL_DIR}/entities/slug.md)
