# HLP — rascunho do método

**Status:** hipótese de método em elaboração. Este texto apresenta a proposta e critérios iniciais para testá-la; não afirma que HLP já foi validado em projetos reais.

## Proposta

**HLP (Help)** combina três capacidades para conduzir um ciclo de vida de desenvolvimento de software (SDLC) com rapidez, qualidade e controle:

- **H — Harness:** uso governado e inteligente de IA para apoiar entendimento do problema, decisões, modelagem e parte da construção. *Harness* significa o conjunto de contexto, regras, ferramentas, verificações e supervisão humana que direciona o uso da IA; não é um modelo de IA específico.
- **L — Low-Code:** construção e testes com recursos visuais, componentes e integrações reutilizáveis, sujeitos às mesmas exigências de engenharia de uma aplicação feita com código tradicional.
- **P — Plataforma:** serviços de autosserviço e caminhos aprovados que encapsulam a complexidade de infraestrutura, segurança operacional e implantação, permitindo entrega e operação consistentes.

Pelo [glossário](GLOSSARIO.md), **HLP é proposto como método**: orienta decisões e ações para produzir e evoluir software. A estrutura de atividades de Pressman funciona como **framework de referência**; o fluxo adotado por uma equipe será um **processo**; cada projeto que aplicar HLP será uma **instância**. Harness, ferramenta low-code e plataforma não são, isoladamente, o método.

## Relação com Pressman

O processo genérico apresentado por Pressman e Maxim usa cinco atividades: **comunicação, planejamento, modelagem, construção e implantação**. Neste rascunho, **análise e design** são partes da modelagem; **testes** integram a construção; **entrega, operação e feedback** estendem a implantação como atividades contínuas. Essa associação é uma **adaptação proposta pelo HLP**, não uma classificação atribuída aos autores. A [editora McGraw Hill](https://www.mheducation.com/highered/product/Software-Engineering-A-Practitioners-Approach-Pressman) apresenta a obra e sua organização em processo, modelagem, qualidade e segurança, testes e gestão.

| Atividade de referência | Aplicação proposta de HLP | Saída e decisão humana |
| --- | --- | --- |
| **Comunicação** | **H** ajuda a organizar entrevistas, perguntas, necessidades, restrições e critérios de aceitação. | Registro de necessidades validado com pessoas interessadas; nenhuma saída de IA substitui a confirmação do negócio. |
| **Planejamento** | **H** apoia decomposição do trabalho, identificação de riscos, alternativas e estimativas. | Plano revisado pela equipe, com prioridades, dependências e hipótese de adequação ao low-code. |
| **Modelagem: análise** | **H** ajuda a explicitar requisitos, regras de negócio, dados, integrações e cenários de erro. | Requisitos rastreáveis e entendimento compartilhado; lacunas e conflitos são resolvidos com especialistas. |
| **Modelagem: design** | **H** apoia opções de arquitetura, experiência do usuário, contratos e decisões documentadas; **L** informa limites e componentes disponíveis. | Design revisado, incluindo segurança, desempenho, acessibilidade e estratégia de testes. |
| **Construção** | **H** auxilia a produzir e revisar componentes, expressões, integrações e documentação; **L** concentra a montagem e reutilização da solução. | Incremento versionado e revisado; código gerado ou customizado recebe as mesmas verificações do restante. |
| **Construção: testes** | **L** oferece ambientes, automações e componentes testáveis; **H** pode sugerir casos de teste e analisar falhas. | Evidência de testes funcionais, de integração e de requisitos não funcionais relevantes, avaliada pela equipe. |
| **Implantação e entrega** | **P** provê ambientes, políticas, pipelines, publicação, observabilidade e retorno à versão anterior. | Versão liberada com aprovação aplicável, monitoramento e plano de recuperação. |
| **Operação e feedback** | **P** registra sinais operacionais; **H** ajuda a sintetizar feedback; **L** facilita alterações incrementais. | Aprendizados convertidos em novas necessidades, reiniciando o ciclo. |

O mapeamento indica **ênfase**, não exclusividade: segurança, qualidade, governança, gestão de configuração e manutenção atravessam todas as atividades. A estrutura deve admitir iterações, inclusive retorno da construção à modelagem quando testes revelarem problemas.

## Práticas, subprocessos e papéis já existentes

O HLP pode organizar práticas existentes sem renomeá-las. A classificação abaixo segue o [glossário](GLOSSARIO.md) e é provisória: a descrição detalhada de cada iniciativa ainda pode alterar seu enquadramento. **JIP** conserva o nome interno “Metodologia de Produtação de Soluções”; neste documento, “metodologia” é o nome da iniciativa, enquanto sua aplicação operacional pode ser descrita como subprocesso do HLP.

| Iniciativa | Enquadramento no HLP | Momento principal | Contribuição esperada |
| --- | --- | --- | --- |
| **JIP — Metodologia de Produtação de Soluções** | Iniciativa/metodologia existente, associada à comunicação | Comunicação e enquadramento da visão de produto | Organizar e comunicar a visão do produto para orientar o refinamento técnico e as atividades seguintes. |
| **WAR — Well Architecture Review** | Grupo e prática de avaliação arquitetural | Após análise e design, antes do desenvolvimento | Examinar a arquitetura proposta e registrar decisões, condições ou ajustes necessários. |
| **Code Review** | Prática de revisão por pares | Construção, antes de integrar alterações | Avaliar implementação, manutenção, segurança e aderência ao design. |
| **Planning** | Prática de planejamento | Planejamento da release ou sprint; revisitada ao longo do ciclo | Definir escopo, prioridades, capacidade, dependências e próximos incrementos. |
| **Demo** | Prática de comunicação e validação | Após um incremento testado | Demonstrar a entrega ao cliente e colher feedback para a próxima iteração. |
| **Fóruns** | Espaços de discussão e formação de equipes | Transversais | Discutir temas, compartilhar decisões e desenvolver competências. |
| **PDCA** | Prática de avaliação e melhoria contínua | Planejamento, acompanhamento e retrospectiva | Comparar plano e resultados, corrigir desvios e atualizar o processo. |

Uma possível sequência é: **JIP e enquadramento → Planning → análise e design assistidos por Harness → WAR → construção e testes → Code Review → implantação pela Plataforma → Demo e PDCA**. A sequência é uma hipótese de integração, sujeita aos critérios reais de JIP e WAR; fóruns podem ocorrer em qualquer ponto. A avaliação WAR é anterior ao desenvolvimento conforme a prática informada, mas mudanças arquiteturais relevantes durante a construção devem voltar para avaliação.

## Ferramentas associadas

As descrições abaixo registram as capacidades informadas para cada ferramenta. Ferramentas de fornecedores e iniciativas internas são alternativas ou componentes do HLP, não requisitos universais para toda instância.

| Ferramenta | Pilar ou atividade principal | Uso informado ou proposto |
| --- | --- | --- |
| **WAR — Architecture Control Plane** | Harness; modelagem e governança arquitetural | Gestão de demandas arquiteturais, ADRs, RFCs, *paved roads* e métricas; apoio ao grupo WAR. |
| **IUPops** | Harness; comunicação e análise de produto | Agentes para análise de produtos candidatos à produtação. |
| **Senpai** | Harness; comunicação, planejamento e modelagem | Agentes para refinamento técnico de demandas, requisitos, planejamento e modelagem. |
| **MHL — Meta Harness Language** | Harness; construção de automações com IA | DSL para desenvolver *harnesses*, pipelines e workflows que envolvem IA generativa. |
| **Devin, Claude e Codex** | Harness; atividades variáveis | Harnesses de fornecedores que podem apoiar análise, construção, revisão ou documentação conforme configuração e governança adotadas. |
| **C3PM** | Harness; análise de sistemas existentes | Agentes para extrair regras de negócio de código e documentação. |
| **Radahn** | Low-Code; construção e testes | Construção de aplicações modernas baseadas em cloud e containerização. A estratégia de testes precisa ser detalhada para cada tipo de aplicação. |
| **Radahn Orquestrador** | Plataforma; implantação e operação | Módulo para plataformização de aplicações. Suas capacidades e limites operacionais precisam ser especificados. |

**WAR** tem dois sentidos distintos aqui: o **grupo Well Architecture Review**, que avalia soluções, e o **Architecture Control Plane**, que gerencia informações e demandas arquiteturais. **MHL** é uma DSL para construir harnesses; **Devin, Claude e Codex** são opções de harness de fornecedores. Isso separa prática, papel e ferramenta conforme o glossário.

## Artefatos e evidências ao longo do ciclo

| Atividade | Artefatos de entrada ou saída | Uso no HLP |
| --- | --- | --- |
| **Comunicação e análise** | Briefs, documentos de produto, requisitos, regulamentações, documentos regulatórios, atas e transcrições | Apoiar JIP, registrar contexto e fontes; produzir necessidades e critérios de aceitação verificáveis. |
| **Planejamento e modelagem** | PRDs, ADRs, RFCs, diagramas, modelos arquiteturais, features e histórias | Explicitar decisões, arquitetura, escopo e prioridades; fornecer material para WAR e Planning. |
| **Construção** | Código em C#, Java, Python e Go; configurações YAML de Radahn, Terraform e outras ferramentas | Implementar, configurar e versionar a solução; submeter alterações a Code Review quando aplicável. |
| **Testes** | Código e resultados de testes unitários, de integração e funcionais | Demonstrar que o incremento atende aos requisitos e identificar regressões. |
| **Entrega e operação** | Documentação de projeto e software; logs, métricas, telemetria, dashboards e relatórios | Apoiar implantação, observabilidade, suporte e avaliação por PDCA. |

Artefatos produzidos ou resumidos com IA precisam conservar referência às fontes e passar por validação apropriada. Para manter rastreabilidade, cada instância deve conseguir relacionar **necessidade → decisão → implementação → teste → entrega → resultado operacional**, ainda que use formatos diferentes dos exemplos acima.

## Regras iniciais do método

1. **Começar pelo problema e pelo risco.** Definir valor esperado, pessoas afetadas, restrições, dados envolvidos e critérios de aceitação antes de escolher ferramenta ou plataforma.
2. **Usar IA com contexto e responsabilidade.** Registrar fontes, limites de acesso, decisões apoiadas por IA e quem as aprovou. Verificar requisitos, fatos, código e testes produzidos com auxílio de IA. O [AI Risk Management Framework do NIST](https://www.nist.gov/itl/ai-risk-management-framework) recomenda incorporar considerações de confiança ao projeto, desenvolvimento, uso e avaliação de sistemas de IA; o [perfil para IA generativa](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) trata riscos específicos dessa tecnologia. Aqui, essas referências são adaptadas ao uso de IA como apoio à engenharia.
3. **Escolher low-code por adequação técnica.** Avaliar regras complexas, extensibilidade, integrações, portabilidade, custos, limites de desempenho e governança. Quando necessário, combinar low-code com componentes escritos em código. A [orientação de ALM da Microsoft para Power Platform](https://learn.microsoft.com/en-us/power-platform/alm/overview-alm) mostra que aplicações low-code também exigem requisitos, arquitetura, testes, controle de mudanças, implantação e manutenção; serve como exemplo de práticas, não como exigência de fornecedor.
4. **Tratar artefatos low-code como software.** Versionar solução e configuração, separar ambientes, revisar alterações, automatizar verificações e manter rastreabilidade entre requisito, implementação e teste. A [documentação de ALM da Microsoft](https://learn.microsoft.com/en-us/power-platform/alm/basics-alm) descreve ambientes, soluções, controle de versão e automação aplicados a esse contexto.
5. **Deslocar a complexidade operacional para a plataforma sem ocultar responsabilidades.** A plataforma fornece serviços aprovados de implantação, identidade, segredos, observabilidade e recuperação; a equipe continua responsável pelo comportamento do produto e pelos requisitos. A [CNCF descreve plataformas internas](https://www.cncf.io/blog/2025/11/19/what-is-platform-engineering/) como camadas de autosserviço que abstraem infraestrutura e padronizam fluxos de entrega.
6. **Incorporar segurança ao ciclo inteiro.** Avaliar riscos e aplicar controles desde requisitos e design até construção, testes e operação. O [Secure Software Development Framework do NIST](https://csrc.nist.gov/pubs/sp/800/218/final) recomenda práticas de desenvolvimento seguro integráveis a cada implementação de SDLC.
7. **Medir resultados para ajustar o método.** Acompanhar tempo de entrega, frequência de implantação, falhas de mudança, recuperação, qualidade, satisfação das pessoas usuárias e esforço de manutenção. As [métricas de desempenho de entrega da DORA](https://dora.dev/guides/dora-metrics/) dão uma base para avaliar velocidade e estabilidade, sem prometer que HLP melhorará esses indicadores automaticamente.

## Processo mínimo para uma instância

1. **Enquadrar:** problema, objetivos, restrições, riscos e critérios de sucesso.
2. **Explorar com Harness:** comunicação, planejamento, análise e design com revisão humana documentada.
3. **Decidir a composição:** confirmar o que será feito em low-code, código tradicional ou serviços da plataforma, com justificativa técnica.
4. **Construir e verificar:** entregar um incremento pequeno; executar testes e revisões proporcionais ao risco.
5. **Publicar pela Plataforma:** usar ambientes, controles de acesso, implantação automatizada, observabilidade e recuperação.
6. **Aprender:** recolher feedback e sinais de operação; atualizar requisitos, componentes e regras do método.

## Pontos que precisam ser definidos e validados

Qual classe de produto é o foco inicial do HLP e quais casos ficam fora de escopo?
- Produtos de software que envolvem informações financeiras são o foco inicial do HLP, enquanto produtos de software que lidam com dados sensíveis de saúde ou informações pessoais identificáveis (PII) ficam fora de escopo.

Quais controles concretos compõem o Harness: fontes permitidas, proteção de dados, revisão humana, avaliação de respostas e registro de decisões?
- Controles concretos do Harness incluem: 
  - Fontes permitidas: apenas fontes de dados confiáveis e verificadas são utilizadas.
  - Proteção de dados: criptografia e anonimização de dados sensíveis.
  - Revisão humana: todas as respostas geradas pelo sistema passam por revisão humana antes da implementação.
  - Avaliação de respostas: critérios claros para avaliar a precisão e relevância das respostas.
  - Registro de decisões: todas as decisões tomadas pelo sistema são registradas para auditoria e rastreabilidade.
  - Métricas de desempenho: monitoramento contínuo da eficácia do sistema e ajustes conforme necessário.
  - Métricas de custo e tempo: análise do custo-benefício e do tempo de implementação das soluções propostas.

Que critérios tornam uma solução adequada ao low-code e quando a equipe deve usar código tradicional?
- Uma solução é adequada ao low-code quando:
  - A complexidade do problema é baixa a moderada.
  - As funcionalidades podem ser implementadas com componentes visuais e pré-construídos.
  - O tempo de desenvolvimento é crítico e a equipe precisa de uma entrega rápida.
  - A manutenção futura será simples e não exigirá alterações complexas no código.
- A equipe deve usar código tradicional quando:
  - A solução requer funcionalidades altamente personalizadas ou complexas.
  - Há necessidade de integração com sistemas legados ou APIs externas que não são suportadas pelo ambiente low-code.
  - A performance e a escalabilidade são críticas e não podem ser garantidas pelo ambiente low-code.
  - A equipe possui habilidades avançadas de programação e prefere ter controle total sobre o código-fonte e a arquitetura da aplicação.

Que capacidades mínimas a Plataforma deve oferecer e quem responde por cada uma?
- As capacidades mínimas que a Plataforma deve oferecer incluem:
  - Gerenciamento de dados: capacidade de armazenar, processar e proteger dados de forma eficiente. Responsável: Equipe de Dados.
  - Integração com sistemas externos: suporte para APIs e conectores para integração com outros sistemas. Responsável: Equipe de Integração.
  - Segurança e conformidade: implementação de medidas de segurança e conformidade com regulamentações aplicáveis. Responsável: Equipe de Segurança.
  - Monitoramento e análise: ferramentas para monitorar o desempenho da aplicação e analisar métricas relevantes. Responsável: Equipe de Monitoramento.
  - Suporte a desenvolvimento low-code: ambiente visual para criação rápida de aplicações. Responsável: Equipe de Desenvolvimento Low-Code.

Quais artefatos e critérios de passagem são obrigatórios por nível de risco?
- Para cada nível de risco, os artefatos e critérios de passagem obrigatórios incluem:
  - Nível Baixo: Documentação básica, testes unitários, revisão por parte interessada.
  - Nível Médio: Documentação detalhada, testes de integração, validação com usuários finais.
  - Nível Alto: Documentação completa, testes abrangentes, auditoria interna, aprovação do comitê de governança.

Quais são as entradas, saídas e critérios reais de JIP na comunicação e de Senpai e WAR nas atividades seguintes?
- As entradas, saídas e critérios reais de JIP, Senpai e WAR são:
  - **JIP (Metodologia de Produtação de Soluções):**
    - Entradas: Hipótese de solução, briefs e documentos de produto disponíveis.
    - Saídas: Visão de produto comunicada, necessidades e contexto para refinamento técnico.
    - Critérios: Validação da visão e rastreabilidade das decisões de produtação; detalhes a confirmar com a prática JIP.
  - **Senpai:**
    - Entradas: Demandas técnicas, requisitos, planejamento e modelagem.
    - Saídas: Refinamento técnico das demandas, documentação de requisitos e planejamento atualizado.
    - Critérios: Validação das decisões técnicas, rastreabilidade das alterações, conformidade com padrões de arquitetura.
  - **WAR (Well Architecture Review):**
    - Entradas: Proposta de arquitetura, diagramas, decisões de design.
    - Saídas: Avaliação da arquitetura, registro de decisões, recomendações de ajustes.
    - Critérios: Conformidade com padrões arquiteturais, identificação de riscos, aprovação do comitê de governança.
- As saídas de JIP alimentam a comunicação e o refinamento técnico. A implantação no Radahn Orquestrador é uma atividade posterior da Plataforma, com seus próprios critérios de qualidade, segurança e conformidade.

Que evidências cada ferramenta ou prática consegue produzir e preservar para revisão, auditoria e rastreabilidade?
- As evidências esperadas das ferramentas e práticas incluem:
  - **JIP:** Visão de produto, fontes utilizadas e registros das decisões comunicadas, permitindo validar o enquadramento e rastrear o refinamento posterior.
  - **Senpai:** Registros de refinamento técnico, documentação de requisitos, decisões técnicas e planejamento atualizado, permitindo auditoria das decisões e rastreabilidade das alterações.
  - **WAR:** Avaliações de arquitetura, registros de decisões, recomendações de ajustes e conformidade com padrões arquiteturais, garantindo rastreabilidade das decisões e suporte à auditoria.
  - **Radahn:** Configurações de aplicações, logs de execução, resultados de testes e métricas de desempenho, permitindo revisão das implementações e rastreabilidade das alterações.
  - **Radahn Orquestrador:** Logs de implantação, métricas de desempenho, registros de observabilidade e histórico de alterações, permitindo auditoria completa do processo de implantação e rastreabilidade das mudanças realizadas no ambiente de produção.

Como comparar uma instância HLP com o processo atual, considerando qualidade, velocidade, segurança e custo de manutenção?
- Você pode comparar uma instância HLP com o processo atual considerando os seguintes aspectos:
  - **Qualidade:** Avaliar a quantidade de falhas, retrabalho e conformidade com requisitos e padrões de segurança. Medir a satisfação do usuário final e a aderência às expectativas do negócio.
  - **Velocidade:** Comparar o tempo total de desenvolvimento, desde a concepção até a entrega, incluindo ciclos de feedback e iterações. Medir a frequência de implantação e o tempo de resposta a mudanças.
  - **Segurança:** Analisar a eficácia dos controles de segurança implementados, incluindo proteção de dados, autenticação, autorização e conformidade com regulamentações aplicáveis. Avaliar incidentes de segurança e vulnerabilidades detectadas.
  - **Custo de manutenção:** Comparar os custos associados à manutenção da solução, incluindo esforço humano, recursos tecnológicos e tempo gasto em correções e atualizações. Avaliar a eficiência do processo de manutenção e a facilidade de realizar alterações futuras.
  - **Custos de IA:** Avaliar os custos associados à implementação e manutenção de soluções de IA, incluindo licenciamento, infraestrutura e uso de modelos. Comparar com os custos de soluções tradicionais e medir o retorno sobre o investimento.

**Hipótese a testar:** uma instância HLP, quando aplicada a um problema adequado e com controles explícitos, poderá reduzir o tempo até a entrega sem aumentar falhas, retrabalho ou risco operacional. Essa hipótese requer pilotos e medições; as referências justificam as práticas propostas, mas não validam o HLP como conjunto.
