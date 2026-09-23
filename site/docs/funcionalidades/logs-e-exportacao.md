---
sidebar_position: 5
title: Logs, métricas e exportação
description: Acompanhe execuções, consumo e saída dos work-items.
---

# Logs, métricas e exportação

O Senpai registra informações suficientes para acompanhar execuções locais e investigar falhas sem depender do console da interface.

## Progresso de execução

Durante uma geração, o painel mostra o estágio atual, a atividade recente e os totais de tokens informados pelo backend. Se uma execução falhar, a mensagem fica associada ao run para diagnóstico.

## Métricas

O resumo do work-item agrega:

- tokens de entrada;
- tokens de saída;
- criação e leitura de cache;
- custo estimado, quando disponibilizado pelo backend.

Tokens de cache são exibidos como detalhamento de observabilidade e não devem ser somados novamente ao total de entrada.

## Logs disponíveis

- log geral da aplicação;
- histórico de runs por work-item;
- registros de prompts e respostas;
- uso agregado em JSON Lines.

:::warning Conteúdo sensível
Logs, prompts e respostas podem conter trechos dos documentos de origem. Não publique o diretório de dados nem o inclua em commits.
:::

## Exportação

Na aba **Artefatos**, use **Exportar tudo** para selecionar um destino e copiar a Wiki e todos os artefatos do work-item. A visualização de um documento também permite exportação individual quando disponível.

O HTML é a representação voltada à leitura. O JSON permanece como fonte semântica interna usada na composição de contexto para novas gerações.
