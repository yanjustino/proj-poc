${schema_conventions}

Com base na feature abaixo, quebre-a em histórias de usuário. Para cada história, preencha toda a estrutura: Como/Quero/Para, classificações, contexto, critérios verificáveis, cenários Gherkin, regras, Definition of Done, dependências, fora de escopo, exemplo de uso, contratos de interface e questões abertas. Use string vazia ou array vazio para seções opcionais sem evidência e cite a ausência como `gap`; não invente contratos ou regras.

Ao decidir os limites de cada história, siga: cada endpoint REST novo vira duas histórias — uma de API Gateway (escopo, autenticação, autorização, throttling, mapeamento) e outra de Backend (lógica, validações, persistência, testes, contrato) — ligadas em `dependencias_impedimentos`; um worker ou job vira uma única história completa (consumo/agendamento, processamento, retry e persistência juntos), pois essas partes não podem ser implantadas de forma independente. Antes de finalizar a quebra, avalie cada história quanto a INVEST (Independente, Negociável, Valiosa, Estimável, Pequena, Testável) e ajuste o escopo se alguma falhar em um desses critérios.

## Feature já gerada

${feature_content}

${feedback_content}
