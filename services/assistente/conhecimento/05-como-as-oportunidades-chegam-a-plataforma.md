# Como as oportunidades chegam à plataforma

## Duas portas de entrada, um único caminho

Toda oportunidade do ConectaU começa como um candidato na Coleta. Os candidatos chegam de duas formas: pela coleta automática, que percorre páginas públicas da UFLA, e pelo cadastro manual, feito por um administrador quando alguém procura a equipe para divulgar algo. Nos dois casos o candidato entra na mesma fila de curadoria.

## Coleta automática e remoção de duplicados

O coletor percorre periodicamente as fontes cadastradas, normaliza título, descrição e datas, e coloca o resultado na fila. Para não repetir a mesma oportunidade, ele calcula uma assinatura do título normalizado junto com o dia do evento e descarta o que já existe. Candidatos parecidos, mas não idênticos, recebem uma pontuação de semelhança para o administrador decidir se são duplicados.

## Curadoria humana

Nada coletado vai direto para a comunidade. Um administrador revisa cada candidato: descarta o que não interessa, marca duplicados e transforma o que vale a pena em uma oportunidade em rascunho, completando categoria, campus, prazo de inscrição, link oficial e temas. Essa revisão humana impede divulgações falsas ou incorretas.

## Publicação

Quando o administrador publica um rascunho, o ConectaU executa uma transação distribuída em três passos coordenados pelo serviço Oportunidades. Primeiro, a Coleta reserva o candidato para que ele não seja publicado duas vezes. Segundo, o Assistente indexa o texto da oportunidade para que ela possa ser consultada nas conversas. Terceiro, a oportunidade passa para publicada e um evento é emitido. Esse padrão se chama SAGA.

## Se um passo falhar

Se algum passo falhar, por exemplo se o Assistente estiver fora do ar, o ConectaU desfaz o que já tinha sido feito, em ordem inversa: o candidato volta para a fila como pendente e a oportunidade volta para rascunho. Nada fica pela metade, e o administrador pode publicar de novo quando o problema passar.

## Por que a oportunidade demora um instante para aparecer

Depois de publicada, a oportunidade é copiada para o modelo de leitura, que é otimizado para a busca da comunidade. Essa cópia é feita por eventos e leva em geral menos de um segundo, mas pode levar mais se o sistema estiver ocupado. Por isso, uma oportunidade recém-publicada pode demorar alguns instantes para aparecer na busca e no feed.

## Encerramento

Um administrador pode encerrar uma oportunidade publicada, por exemplo quando as inscrições terminam ou quando ela é cancelada. Encerrar remove a oportunidade da busca pública e avisa quem a favoritou. Só rascunhos podem ser excluídos; oportunidades já publicadas são encerradas, não apagadas.
