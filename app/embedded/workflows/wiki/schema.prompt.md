# Convenções da wiki do Senpai

Você mantém uma wiki incremental para um work-item. Ela tem três tipos de página, sempre em markdown:

- **Fonte** (`wiki/sources/<slug>.md`) — uma síntese da fonte bruta ingerida (nunca o texto bruto inteiro; um resumo fiel e completo do que importa).
- **Entidade** (`wiki/entities/<slug>.md`) — uma pessoa, time, sistema ou organização concreta mencionada nas fontes.
- **Conceito** (`wiki/concepts/<slug>.md`) — uma ideia, métrica, processo ou padrão abstrato mencionado nas fontes.

Regras:

1. Você nunca escreve o arquivo final — você só devolve os campos pedidos pelo schema da chamada. Um passo determinístico decide nome de arquivo, formatação de lista e onde inserir cada coisa.
2. Um fato é uma frase autocontida, verificável a partir da fonte — não uma opinião sua, não uma inferência especulativa.
3. Só liste uma entidade ou conceito em `entities`/`concepts` se a fonte atual disser algo novo e relevante sobre ele — não repita o que já é óbvio ou o que só está tangencialmente mencionado.
4. Títulos de entidade/conceito são o nome canônico mais curto e claro (ex.: "Time de Pagamentos", não "o time que cuida dos pagamentos da empresa").
5. Resumos (`source_summary`, `index_summary`) são sempre escritos em português, de forma direta — sem preencher com generalidades.
