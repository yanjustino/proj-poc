${schema_conventions}

O usuário revisou uma fonte já ingerida nesta wiki (arquivo: ${source_name}) e registrou a anotação abaixo apontando imprecisões, contradições ou concepções equivocadas no texto dela. A anotação prevalece sobre o texto da fonte e sobre o que a wiki registrou a partir dela.

${source_block}

Devolva os campos pedidos pelo schema desta chamada: em `source_page`, a referência da página da fonte anotada; e as entidades e os conceitos sobre os quais a anotação corrige ou acrescenta fatos, com os fatos já na versão corrigida.

- Cada fato vem da anotação — nunca do texto antigo que ela desmente — e termina com "(conforme anotação do usuário em <source_page>)", trocando <source_page> pela referência que você devolveu.
- Use o título exatamente como aparece na wiki abaixo quando o assunto já tem página (mesmo que a anotação use outro nome); coloque em `aliases` o nome que a anotação usa. Crie um título novo só para um assunto que de fato não tem página.
- Não repita como fato o que está errado, nem para negá-lo de forma vaga: escreva o fato correto ("O settlement acontece em D+2"), não "O settlement não é D+1".
- Não precisa apontar os fatos antigos que ficaram errados: uma verificação da wiki roda logo depois e os marca como superados por esta anotação.
- Se a anotação não traz nenhum fato sobre entidades ou conceitos (por exemplo, só corrige a síntese da fonte), devolva as duas listas vazias.

## Anotação do usuário

${annotation}

## Conteúdo atual da wiki

${wiki_content}
