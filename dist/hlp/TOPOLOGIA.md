# TOPOLOGIA DE TIME no HLP method.

## Time cross squad
- Especialista: Responsável por fornecer conhecimento especializado em uma área específica, auxiliando na tomada de decisões técnicas.
- SRE: Responsável por manter a estabilidade e confiabilidade do sistema, monitorando e respondendo a incidentes.
- PM: Responsável por gerenciar o projeto, garantindo que os objetivos sejam alcançados dentro do prazo e orçamento.

## Squad
- Engenheiro: Responsável pelo desenvolvimento e manutenção do software, implementando novas funcionalidades e corrigindo
- Analista de sistemas: Responsável por analisar os requisitos do sistema, projetar soluções e garantir que o software atenda às necessidades do usuário.
- SME: Subject Matter Expert, responsável por fornecer conhecimento especializado em uma área específica, auxiliando na tomada de decisões técnicas.

## Topologia

1. **Time cross squad**: A topologia de time cross squad envolve a colaboração entre diferentes squads, permitindo que especialistas de diferentes áreas trabalhem juntos para alcançar objetivos comuns. Essa abordagem promove a troca de conhecimento e a resolução de problemas complexos.

2. **Squad**: A topologia de squad é composta por um grupo de profissionais com habilidades complementares, trabalhando juntos para desenvolver e manter o software. Cada membro do squad tem responsabilidades específicas, garantindo que todas as áreas do projeto sejam cobertas.

## Modelo de estrutura de time

```mermaid
graph TD
    Z0[GPM] -->|Colaboração| AA

    subgraph AA[Comitê WAR]
        Z1[ESPECs </br> Fornece conhecimento especializado]
        Z2[SREs </br> Mantém a estabilidade e confiabilidade do sistema]
    end
    
    AA -->|Colaboração| A0
    AA -->|Colaboração| B0[Time cross squad] -->|Colaboração| B00[Squads]
    AA -->|Colaboração| C0[Time cross squad] -->|Colaboração| C00[Squads]

    subgraph A0[Time cross squad]
        AA0[Coordenador do time </br> Garante a comunicação e colaboração entre os squads]
        AA1[1 PM <br/> Gerencia o projeto e garante que os objetivos sejam alcançados]
        AA2[1 SME </br> Fornece conhecimento especializado]
    end 
    
    subgraph SA[Squad A]
        SA2[1 Analista de sistemas </br> Analisa requisitos e projeta soluções]
        SA1[2 Engenheiros</br> Desenvolvem e mantêm o software]
    end

    subgraph SB[Squad B]
        SB2[1 Analista de sistemas </br> Analisa requisitos e projeta soluções]
        SB1[2 Engenheiros</br> Desenvolvem e mantêm o software]
    end

    subgraph SC[Squad C]
        SC2[1 Analista de sistemas </br> Analisa requisitos e projeta soluções]
        SC1[2 Engenheiros</br> Desenvolvem e mantêm o software]
    end

    A0[Time cross squad] -->|Colaboração| SA 
    A0[Time cross squad] -->|Colaboração| SB
    A0[Time cross squad] -->|Colaboração| SC
```
