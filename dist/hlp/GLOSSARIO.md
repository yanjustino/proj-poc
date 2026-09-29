# Glossário para engenharia de software

Este glossário fixa um vocabulário de trabalho para descrever um método de engenharia de software. Os termos não têm fronteiras universais: organizações e autores podem usá-los de outras formas. Aqui, cada definição indica **o que o termo descreve** e **como ele se relaciona com os demais**.

## Termos centrais

| Termo | Definição neste documento | Exemplo em engenharia de software |
| --- | --- | --- |
| **Método** | Forma estruturada e justificável de alcançar um objetivo. Define princípios, decisões, atividades e critérios de aplicação; pode combinar técnicas, processos e ferramentas. | Um método para evoluir sistemas legados que orienta como identificar riscos, escolher uma estratégia de mudança e verificar resultados. |
| **Metodologia** | Estudo, fundamentação ou organização dos métodos: explica por que e quando determinados métodos são adequados, como se relacionam e como avaliá-los. No uso corrente, também pode nomear um conjunto de métodos; neste projeto, esse segundo sentido será indicado explicitamente quando necessário. | Uma metodologia de pesquisa que compara métodos de desenvolvimento por contexto, evidência e limitações. |
| **Framework** | Estrutura reutilizável que oferece conceitos, componentes, regras ou pontos de extensão para orientar implementações específicas. Estabelece um espaço de possibilidades, sem necessariamente prescrever cada passo. | Um framework de trabalho que define papéis, eventos e artefatos, deixando a equipe decidir práticas técnicas específicas. |
| **Processo** | Sequência ou fluxo de atividades, decisões, responsáveis, entradas e saídas para produzir um resultado. Descreve principalmente **como o trabalho acontece**. | Fluxo de uma mudança: registrar demanda, analisar impacto, implementar, revisar, testar e disponibilizar. |
| **Instância** | Aplicação concreta de uma estrutura, método ou processo abstrato em um contexto delimitado. Possui participantes, dados, restrições e resultados reais. | A aplicação do método na modernização do serviço de pagamentos da equipe X durante um trimestre. |

## Elementos de aplicação

| Termo | Definição neste documento | Exemplo em engenharia de software |
| --- | --- | --- |
| **Abordagem** | Direção geral escolhida para lidar com um problema; pode orientar a seleção de métodos e técnicas. | Evoluir uma aplicação incrementalmente em vez de substituí-la de uma só vez. |
| **Princípio** | Regra orientadora relativamente estável para decidir entre alternativas. | Preferir mudanças pequenas e reversíveis quando a incerteza é alta. |
| **Prática** | Hábito de trabalho repetível adotado por pessoas ou equipes. | Revisar código em pares antes da integração. |
| **Técnica** | Procedimento específico para executar uma atividade ou resolver uma classe de problemas. | Usar análise de causa raiz para investigar um incidente. |
| **Procedimento** | Instruções operacionais detalhadas para executar uma tarefa de maneira consistente. | Passos para realizar uma publicação com verificação e retorno à versão anterior. |
| **Ferramenta** | Recurso material ou digital que apoia a execução de uma técnica, prática ou processo; não determina, por si só, o método. | Um sistema de integração contínua que executa testes e registra resultados. |
| **Artefato** | Informação ou produto produzido, usado ou modificado durante o trabalho. | Código-fonte, registro de decisão arquitetural, plano de testes ou relatório de incidente. |
| **Papel** | Conjunto de responsabilidades exercidas por uma pessoa ou grupo em determinado contexto; não equivale necessariamente a um cargo. | Responsável pela revisão de segurança de uma alteração. |
| **Etapa** | Parte identificável de um processo ou método, normalmente com objetivo e critério de conclusão. | Avaliar riscos antes de escolher a estratégia de implementação. |
| **Critério** | Condição usada para decidir, avaliar ou concluir uma atividade. | Considerar pronta uma mudança quando os testes relevantes passam e a documentação afetada está atualizada. |
| **Padrão** | Solução recorrente e documentada para um problema que aparece em contextos semelhantes, incluindo consequências e condições de uso. | O padrão *strangler fig* para substituir gradualmente funcionalidades de um sistema legado. |

## Como distinguir os termos

Uma **abordagem** indica a direção. Um **método** organiza o raciocínio e a ação para atingir um objetivo. Um **framework** oferece uma estrutura que pode abrigar ou orientar vários métodos. Um **processo** descreve o fluxo de trabalho adotado. **Práticas**, **técnicas** e **procedimentos** executam partes desse trabalho em diferentes níveis de detalhe. Uma **ferramenta** dá suporte à execução. A **instância** é o caso real em que essas escolhas foram aplicadas.

Por exemplo, uma equipe pode adotar a abordagem de evolução incremental, usar um método de modernização orientado por risco, organizar o trabalho em um framework próprio, executar um processo de entrega contínua, aplicar a técnica de testes de caracterização e usar uma ferramenta de integração contínua. A modernização de um serviço específico, por essa equipe e em um período definido, é uma instância do método.

**Regra de nomenclatura para este projeto:** chamar a proposta principal de **método** quando ela orientar decisões e ações para um objetivo definido. Usar **metodologia** para a fundamentação, comparação e avaliação de métodos; **framework** para uma estrutura extensível; **processo** para o fluxo operacional; e **instância** para uma aplicação concreta. Se a proposta evoluir e passar a conter várias estruturas ou métodos independentes, sua classificação poderá ser revista.
