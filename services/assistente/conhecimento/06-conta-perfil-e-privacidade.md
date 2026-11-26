# Conta, perfil e privacidade

## Criando a conta

Para criar uma conta, informe nome, e-mail, senha, curso e campus, e, se quiser, uma lista de interesses. Os campi aceitos são Lavras e São Sebastião do Paraíso. Cada e-mail só pode ser usado em uma conta; tentar cadastrar um e-mail repetido retorna erro de conflito. A conta nova é sempre de estudante; o papel de administrador é concedido pela equipe.

## Entrando

O login devolve um token de acesso com validade limitada. O portal guarda o token no navegador e o envia a cada pedido. Quando o token expira, é preciso entrar de novo. Sem token, é possível ver as oportunidades publicadas, mas não salvar, criar lembretes nem conversar com o assistente.

## Perfil e interesses

O perfil guarda curso, campus e interesses, como pesquisa, tecnologia ou extensão. O feed usa o campus e os interesses para mostrar primeiro o que combina com você. Se nenhuma oportunidade combinar com os interesses, o feed mostra as do seu campus sem filtrar por tema. Você pode editar o perfil quando quiser, e só você pode ler e alterar o seu perfil.

## Como a senha é protegida

A senha nunca é guardada em texto puro. O ConectaU guarda apenas um resumo criptográfico da senha, gerado com salt e com um algoritmo próprio para senhas. Ninguém consegue ler a senha original a partir dele, nem a equipe.

## O que o assistente sabe sobre você

Nada além do que você escreve na conversa. O assistente funciona num serviço isolado, com banco próprio, e não tem acesso ao seu e-mail, à sua senha, ao seu perfil, aos seus favoritos nem aos seus lembretes. Ele consulta apenas informações públicas: a base de conhecimento do ConectaU e as oportunidades publicadas. Por isso, não escreva dados pessoais, como CPF, senha ou documentos, nas perguntas.

## Envio de texto a um provedor externo

Para gerar as respostas, o assistente envia a sua pergunta e os trechos públicos encontrados a um provedor externo de modelo de linguagem. Os dados pessoais do seu cadastro não fazem parte desse envio. As conversas ficam registradas no banco do assistente, vinculadas à sua conta, e só você consegue continuar uma conversa sua.
