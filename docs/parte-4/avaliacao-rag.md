# Avaliação do RAG — resultados

> Gerado por `scripts/avaliar-rag.mjs` em 2026-11-26 12:31 (UTC), pelo gateway, com as perguntas de [`perguntas-avaliacao.json`](perguntas-avaliacao.json).
> LLM: **não executado** (sem `GROQ_API_KEY`): só a parte de recuperação foi medida. Embeddings: `multilingual-e5-small` (local). A metodologia e a análise estão em [`rag-e-agente.md`](rag-e-agente.md#avaliação-do-rag).

## 1. Recuperação (busca vetorial, sem LLM)

Em 9 perguntas com fonte conhecida (a de catálogo depende da ferramenta do agente, e a fora do escopo não tem fonte): **acerto no 1º trecho 89%**, **acerto entre os 3 primeiros 100%**, MRR 0.94.

| Pergunta | Fonte esperada | Posição no top 3 | 1º trecho recuperado | Similaridade |
|---|---|---|---|---|
| P1 Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada? | 04-favoritos-lembretes-e-avisos.md | 1 | Favoritos, lembretes e avisos — Lembretes de prazo | 0.916 |
| P2 O ConectaU faz a minha inscrição na oportunidade? | 01-sobre-o-conectau.md | 2 | Como participar de uma oportunidade — Passo a passo | 0.905 |
| P3 O que acontece com os meus lembretes quando uma oportunidade é encerrada? | 04-favoritos-lembretes-e-avisos.md | 1 | Favoritos, lembretes e avisos — Quando a oportunidade é encerrada | 0.912 |
| P4 Por que uma oportunidade recém-publicada demora um pouco para aparecer na busca? | 05-como-as-oportunidades-chegam-a-plataforma.md | 1 | Como as oportunidades chegam à plataforma — Por que a oportunidade demora um instante para aparecer | 0.922 |
| P5 O assistente consegue ver o meu perfil e os meus favoritos? | 06-conta-perfil-e-privacidade.md | 1 | Conta, perfil e privacidade — O que o assistente sabe sobre você | 0.88 |
| P6 Qual a nota mínima e a carga horária exigidas no edital de monitoria de Exatas? | edital: Edital de Monitoria | 1 | Edital de Monitoria — disciplinas de Exatas | 0.921 |
| P7 Quantas vagas tem o Workshop de Docker e Kubernetes e o que devo levar? | edital: Workshop de Docker | 1 | Workshop de Docker e Kubernetes | 0.914 |
| P8 Quais documentos a bolsa de iniciação científica em agricultura digital pede? | edital: Iniciação Científica em Agricultura Digital | 1 | Bolsa de Iniciação Científica em Agricultura Digital | 0.917 |
| P9 Quais bolsas estão com inscrições abertas no campus de Lavras? | edital: Monitoria | não recuperada | O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas | 0.877 |
| P10 Qual é o valor mensal da bolsa de iniciação científica em agricultura digital? | edital: Iniciação Científica em Agricultura Digital | 1 | Bolsa de Iniciação Científica em Agricultura Digital | 0.925 |
| P11 Me passa uma receita de bolo de cenoura | — | recusada (fora do escopo) | — | — |

## 2. Com e sem recuperação

> Esta seção é preenchida quando o script roda com `GROQ_API_KEY` configurada. Sem a chave, os modos com LLM respondem em modo degradado e não há o que comparar.

| Modo | Respostas do LLM | Fatos esperados presentes | Citou fontes | Admitiu não saber (P10) | Recusou fora do escopo (P11) | Latência média | Tokens médios (entrada/saída) | Custo médio |
|---|---|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | — | 92% | — | — | sim | 26 ms | — | — |
| LLM sem recuperação | 0/11 | — | — | — | sim | 25 ms | — | — |
| Cadeia RAG | 0/11 | — | — | — | sim | 22 ms | — | — |
| Agente (RAG + ferramentas) | 0/11 | — | — | — | sim | 29 ms | — | — |

"Fatos esperados presentes" conta, em todas as perguntas, quantos fatos da lista `fatos` aparecem no texto da resposta (busca de texto, sem acento). No modo "só recuperação" a resposta é o próprio texto dos trechos devolvidos.

## 3. Pergunta a pergunta

### P1 — Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada?

*Regra própria do ConectaU (padrão de 48 horas): um modelo sem recuperação não tem como saber.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 1 | — | 23 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 30 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 24 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 39 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Lembretes de prazo: O lembrete serve para não perder o prazo de inscrição. Ao criar um lembrete, você escolhe com quantas horas de antecedência quer ser avisada, de 1 hora até 720 horas, que são 30 dias. Se você não escolher, o ConectaU usa 48 horas, ou seja, dois dias antes do prazo. Cada pessoa tem no máximo um lembrete por oportunidade [F2] Favoritos, lembretes e avisos — Quando o lembrete dispara: O horário de disparo é o prazo de inscrição menos a antecedência escolhida. Se esse horário já passou, o lembrete dispara imediatamente. Um verificador roda a cada 30 segundos e dispara os lembretes vencidos, gerando um aviso de prazo próximo dentro da plataforma. Depois de disparado, o lembrete não dispara de novo. [F3] Favoritos, lembretes e avisos — Quan

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Lembretes de prazo: O lembrete serve para não perder o prazo de inscrição. Ao criar um lembrete, você escolhe com quantas horas de antecedência quer ser avisada, de 1 hora até 720 horas, que são 30 dias. Se você não escolher, o ConectaU usa 48 horas, ou seja, dois dias antes do prazo. Cada pessoa tem no máximo um lembrete por oportunidade [F2] Favoritos, lembretes e avisos — Quando o lembrete dispara: O horário de disparo é o prazo de inscrição menos a antecedência escolhida. Se esse horário já passou, o lembrete dispara imediatamente. Um verificador roda a cada 30 segundos e dispara os lembretes vencidos, gerando um aviso de prazo próximo dentro da plataforma. Depois de dispara

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Lembretes de prazo: O lembrete serve para não perder o prazo de inscrição. Ao criar um lembrete, você escolhe com quantas horas de antecedência quer ser avisada, de 1 hora até 720 horas, que são 30 dias. Se você não escolher, o ConectaU usa 48 horas, ou seja, dois dias antes do prazo. Cada pessoa tem no máximo um lembrete por oportunidade [F2] Favoritos, lembretes e avisos — Quando o lembrete dispara: O horário de disparo é o prazo de inscrição menos a antecedência escolhida. Se esse horário já passou, o lembrete dispara imediatamente. Um verificador roda a cada 30 segundos e dispara os lembretes vencidos, gerando um aviso de prazo próximo dentro da plataforma. Depois de dispara

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Lembretes de prazo: O lembrete serve para não perder o prazo de inscrição. Ao criar um lembrete, você escolhe com quantas horas de antecedência quer ser avisada, de 1 hora até 720 horas, que são 30 dias. Se você não escolher, o ConectaU usa 48 horas, ou seja, dois dias antes do prazo. Cada pessoa tem no máximo um lembrete por oportunidade [F2] Favoritos, lembretes e avisos — Quando o lembrete dispara: O horário de disparo é o prazo de inscrição menos a antecedência escolhida. Se esse horário já passou, o lembrete dispara imediatamente. Um verificador roda a cada 30 segundos e dispara os lembretes vencidos, gerando um aviso de prazo próximo dentro da plataforma. Depois de dispara

</details>

### P2 — O ConectaU faz a minha inscrição na oportunidade?

*Decisão de produto: a inscrição é sempre no canal oficial.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 2 | — | 38 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 1/1 | sim | 2 | — | 26 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 1/1 | sim | 2 | — | 31 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 1/1 | sim | 2 | — | 17 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Como participar de uma oportunidade — Passo a passo: 1. Encontre a oportunidade no feed ou na busca do ConectaU. 2. Leia a descrição inteira: requisitos, documentos, carga horária e datas. 3. Salve a oportunidade como favorita e crie um lembrete de prazo. 4. Abra o link da fonte oficial. A inscrição é feita lá, e não no ConectaU. 5. Siga as instruções do canal oficial e [F2] Sobre o ConectaU — O que é o ConectaU: O ConectaU é uma plataforma web que reúne e personaliza as oportunidades da UFLA: eventos, atividades, bolsas, projetos e processos seletivos. Ela funciona como uma camada complementar aos canais oficiais da universidade. O objetivo é que a oportunidade certa chegue à pessoa certa, no momento certo, antes que o prazo d [F3] Sobre o ConectaU — O ConectaU não realiza inscrições:

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como participar de uma oportunidade — Passo a passo: 1. Encontre a oportunidade no feed ou na busca do ConectaU. 2. Leia a descrição inteira: requisitos, documentos, carga horária e datas. 3. Salve a oportunidade como favorita e crie um lembrete de prazo. 4. Abra o link da fonte oficial. A inscrição é feita lá, e não no ConectaU. 5. Siga as instruções do canal oficial e [F2] Sobre o ConectaU — O que é o ConectaU: O ConectaU é uma plataforma web que reúne e personaliza as oportunidades da UFLA: eventos, atividades, bolsas, projetos e processos seletivos. Ela funciona como uma camada complementar aos canais oficiais da universidade. O objetivo é que a oportunidade certa chegue à pessoa certa, no momento certo, a

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como participar de uma oportunidade — Passo a passo: 1. Encontre a oportunidade no feed ou na busca do ConectaU. 2. Leia a descrição inteira: requisitos, documentos, carga horária e datas. 3. Salve a oportunidade como favorita e crie um lembrete de prazo. 4. Abra o link da fonte oficial. A inscrição é feita lá, e não no ConectaU. 5. Siga as instruções do canal oficial e [F2] Sobre o ConectaU — O que é o ConectaU: O ConectaU é uma plataforma web que reúne e personaliza as oportunidades da UFLA: eventos, atividades, bolsas, projetos e processos seletivos. Ela funciona como uma camada complementar aos canais oficiais da universidade. O objetivo é que a oportunidade certa chegue à pessoa certa, no momento certo, a

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como participar de uma oportunidade — Passo a passo: 1. Encontre a oportunidade no feed ou na busca do ConectaU. 2. Leia a descrição inteira: requisitos, documentos, carga horária e datas. 3. Salve a oportunidade como favorita e crie um lembrete de prazo. 4. Abra o link da fonte oficial. A inscrição é feita lá, e não no ConectaU. 5. Siga as instruções do canal oficial e [F2] Sobre o ConectaU — O que é o ConectaU: O ConectaU é uma plataforma web que reúne e personaliza as oportunidades da UFLA: eventos, atividades, bolsas, projetos e processos seletivos. Ela funciona como uma camada complementar aos canais oficiais da universidade. O objetivo é que a oportunidade certa chegue à pessoa certa, no momento certo, a

</details>

### P3 — O que acontece com os meus lembretes quando uma oportunidade é encerrada?

*Comportamento do serviço Engajamento ao receber o evento de encerramento.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 1 | — | 36 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 27 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 31 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 60 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Quando a oportunidade é encerrada: Ao encerrar uma oportunidade, os lembretes ainda agendados dela são cancelados, ela some da busca pública e quem a favoritou recebe um aviso de encerramento. A oportunidade continua no histórico do administrador, mas não aparece mais para a comunidade. [F2] Favoritos, lembretes e avisos — Quando o prazo muda: Se um administrador altera o prazo de inscrição de uma oportunidade publicada, o ConectaU recalcula os lembretes que ainda estão agendados, mantendo a mesma antecedência, e avisa quem favoritou que a oportunidade foi alterada. Assim, o lembrete acompanha o novo prazo sem que a pessoa precise recriá-lo. [F3] Como as oportunidades chegam à plataforma — Encerramento: Um administrador pode encerrar uma oportunidade pub

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Quando a oportunidade é encerrada: Ao encerrar uma oportunidade, os lembretes ainda agendados dela são cancelados, ela some da busca pública e quem a favoritou recebe um aviso de encerramento. A oportunidade continua no histórico do administrador, mas não aparece mais para a comunidade. [F2] Favoritos, lembretes e avisos — Quando o prazo muda: Se um administrador altera o prazo de inscrição de uma oportunidade publicada, o ConectaU recalcula os lembretes que ainda estão agendados, mantendo a mesma antecedência, e avisa quem favoritou que a oportunidade foi alterada. Assim, o lembrete acompanha o novo prazo sem que a pessoa precise recriá-lo. [F3] Como as oportunidades chegam à p

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Quando a oportunidade é encerrada: Ao encerrar uma oportunidade, os lembretes ainda agendados dela são cancelados, ela some da busca pública e quem a favoritou recebe um aviso de encerramento. A oportunidade continua no histórico do administrador, mas não aparece mais para a comunidade. [F2] Favoritos, lembretes e avisos — Quando o prazo muda: Se um administrador altera o prazo de inscrição de uma oportunidade publicada, o ConectaU recalcula os lembretes que ainda estão agendados, mantendo a mesma antecedência, e avisa quem favoritou que a oportunidade foi alterada. Assim, o lembrete acompanha o novo prazo sem que a pessoa precise recriá-lo. [F3] Como as oportunidades chegam à p

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Quando a oportunidade é encerrada: Ao encerrar uma oportunidade, os lembretes ainda agendados dela são cancelados, ela some da busca pública e quem a favoritou recebe um aviso de encerramento. A oportunidade continua no histórico do administrador, mas não aparece mais para a comunidade. [F2] Favoritos, lembretes e avisos — Quando o prazo muda: Se um administrador altera o prazo de inscrição de uma oportunidade publicada, o ConectaU recalcula os lembretes que ainda estão agendados, mantendo a mesma antecedência, e avisa quem favoritou que a oportunidade foi alterada. Assim, o lembrete acompanha o novo prazo sem que a pessoa precise recriá-lo. [F3] Como as oportunidades chegam à p

</details>

### P4 — Por que uma oportunidade recém-publicada demora um pouco para aparecer na busca?

*Consistência eventual do CQRS: a busca lê o modelo de leitura, atualizado por eventos.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 1 | — | 27 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 21 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 22 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 21 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Como as oportunidades chegam à plataforma — Por que a oportunidade demora um instante para aparecer: Depois de publicada, a oportunidade é copiada para o modelo de leitura, que é otimizado para a busca da comunidade. Essa cópia é feita por eventos e leva em geral menos de um segundo, mas pode levar mais se o sistema estiver ocupado. Por isso, uma oportunidade recém-publicada pode demorar alguns instantes para aparecer [F2] Como participar de uma oportunidade — Se a dúvida não estiver na descrição: O ConectaU mostra apenas o que foi divulgado na fonte oficial e curado por um administrador. Se uma informação, como valor da bolsa ou número de vagas, não estiver na descrição, o caminho é consultar o canal oficial pelo link da oportunidade. O assistente também não inventa informação: se não

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como as oportunidades chegam à plataforma — Por que a oportunidade demora um instante para aparecer: Depois de publicada, a oportunidade é copiada para o modelo de leitura, que é otimizado para a busca da comunidade. Essa cópia é feita por eventos e leva em geral menos de um segundo, mas pode levar mais se o sistema estiver ocupado. Por isso, uma oportunidade recém-publicada pode demorar alguns instantes para aparecer [F2] Como participar de uma oportunidade — Se a dúvida não estiver na descrição: O ConectaU mostra apenas o que foi divulgado na fonte oficial e curado por um administrador. Se uma informação, como valor da bolsa ou número de vagas, não estiver na descrição, o caminho é consultar o canal oficial 

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como as oportunidades chegam à plataforma — Por que a oportunidade demora um instante para aparecer: Depois de publicada, a oportunidade é copiada para o modelo de leitura, que é otimizado para a busca da comunidade. Essa cópia é feita por eventos e leva em geral menos de um segundo, mas pode levar mais se o sistema estiver ocupado. Por isso, uma oportunidade recém-publicada pode demorar alguns instantes para aparecer [F2] Como participar de uma oportunidade — Se a dúvida não estiver na descrição: O ConectaU mostra apenas o que foi divulgado na fonte oficial e curado por um administrador. Se uma informação, como valor da bolsa ou número de vagas, não estiver na descrição, o caminho é consultar o canal oficial 

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Como as oportunidades chegam à plataforma — Por que a oportunidade demora um instante para aparecer: Depois de publicada, a oportunidade é copiada para o modelo de leitura, que é otimizado para a busca da comunidade. Essa cópia é feita por eventos e leva em geral menos de um segundo, mas pode levar mais se o sistema estiver ocupado. Por isso, uma oportunidade recém-publicada pode demorar alguns instantes para aparecer [F2] Como participar de uma oportunidade — Se a dúvida não estiver na descrição: O ConectaU mostra apenas o que foi divulgado na fonte oficial e curado por um administrador. Se uma informação, como valor da bolsa ou número de vagas, não estiver na descrição, o caminho é consultar o canal oficial 

</details>

### P5 — O assistente consegue ver o meu perfil e os meus favoritos?

*Isolamento de dados pessoais: o Assistente não acessa perfil, favoritos nem lembretes.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 1 | — | 23 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 28 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 24 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 1/1 | sim | 1 | — | 22 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Conta, perfil e privacidade — O que o assistente sabe sobre você: Nada além do que você escreve na conversa. O assistente funciona num serviço isolado, com banco próprio, e não tem acesso ao seu e-mail, à sua senha, ao seu perfil, aos seus favoritos nem aos seus lembretes. Ele consulta apenas informações públicas: a base de conhecimento do ConectaU e as oportunidades publicadas. Por [F2] Conta, perfil e privacidade — Perfil e interesses: O perfil guarda curso, campus e interesses, como pesquisa, tecnologia ou extensão. O feed usa o campus e os interesses para mostrar primeiro o que combina com você. Se nenhuma oportunidade combinar com os interesses, o feed mostra as do seu campus sem filtrar por tema. Você pode editar o perfil quando quiser, e só você [F3] Sobre o ConectaU — O que a p

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Conta, perfil e privacidade — O que o assistente sabe sobre você: Nada além do que você escreve na conversa. O assistente funciona num serviço isolado, com banco próprio, e não tem acesso ao seu e-mail, à sua senha, ao seu perfil, aos seus favoritos nem aos seus lembretes. Ele consulta apenas informações públicas: a base de conhecimento do ConectaU e as oportunidades publicadas. Por [F2] Conta, perfil e privacidade — Perfil e interesses: O perfil guarda curso, campus e interesses, como pesquisa, tecnologia ou extensão. O feed usa o campus e os interesses para mostrar primeiro o que combina com você. Se nenhuma oportunidade combinar com os interesses, o feed mostra as do seu campus sem filtrar por tema. Você po

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Conta, perfil e privacidade — O que o assistente sabe sobre você: Nada além do que você escreve na conversa. O assistente funciona num serviço isolado, com banco próprio, e não tem acesso ao seu e-mail, à sua senha, ao seu perfil, aos seus favoritos nem aos seus lembretes. Ele consulta apenas informações públicas: a base de conhecimento do ConectaU e as oportunidades publicadas. Por [F2] Conta, perfil e privacidade — Perfil e interesses: O perfil guarda curso, campus e interesses, como pesquisa, tecnologia ou extensão. O feed usa o campus e os interesses para mostrar primeiro o que combina com você. Se nenhuma oportunidade combinar com os interesses, o feed mostra as do seu campus sem filtrar por tema. Você po

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Conta, perfil e privacidade — O que o assistente sabe sobre você: Nada além do que você escreve na conversa. O assistente funciona num serviço isolado, com banco próprio, e não tem acesso ao seu e-mail, à sua senha, ao seu perfil, aos seus favoritos nem aos seus lembretes. Ele consulta apenas informações públicas: a base de conhecimento do ConectaU e as oportunidades publicadas. Por [F2] Conta, perfil e privacidade — Perfil e interesses: O perfil guarda curso, campus e interesses, como pesquisa, tecnologia ou extensão. O feed usa o campus e os interesses para mostrar primeiro o que combina com você. Se nenhuma oportunidade combinar com os interesses, o feed mostra as do seu campus sem filtrar por tema. Você po

</details>

### P6 — Qual a nota mínima e a carga horária exigidas no edital de monitoria de Exatas?

*Dados que só existem no texto do edital indexado pela SAGA.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 2/2 | sim | 1 | — | 35 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 47 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 28 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 35 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Edital de Monitoria — disciplinas de Exatas: Edital de Monitoria — disciplinas de Exatas Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscriçã [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Glossário acadêmico — Monitoria: Monitoria é o apoi

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Edital de Monitoria — disciplinas de Exatas: Edital de Monitoria — disciplinas de Exatas Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscriçã [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista complet

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Edital de Monitoria — disciplinas de Exatas: Edital de Monitoria — disciplinas de Exatas Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscriçã [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista complet

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Edital de Monitoria — disciplinas de Exatas: Edital de Monitoria — disciplinas de Exatas Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscriçã [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista complet

</details>

### P7 — Quantas vagas tem o Workshop de Docker e Kubernetes e o que devo levar?

*Dados do edital do workshop.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 2/2 | sim | 1 | — | 34 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 17 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 14 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 40 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Workshop de Docker e Kubernetes: Workshop de Docker e Kubernetes Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado. Categoria: EVENTO. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: 2026-12-11. [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Sobre o ConectaU — O que a pessoa consegue fazer na plataforma: - Criar uma conta inform

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Workshop de Docker e Kubernetes: Workshop de Docker e Kubernetes Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado. Categoria: EVENTO. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: 2026-12-11. [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Sobre o Con

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Workshop de Docker e Kubernetes: Workshop de Docker e Kubernetes Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado. Categoria: EVENTO. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: 2026-12-11. [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Sobre o Con

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Workshop de Docker e Kubernetes: Workshop de Docker e Kubernetes Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado. Categoria: EVENTO. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: 2026-12-11. [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Sobre o Con

</details>

### P8 — Quais documentos a bolsa de iniciação científica em agricultura digital pede?

*Lista de documentos do edital da bolsa.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 2/2 | sim | 1 | — | 26 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 16 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 13 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 2/2 | sim | 1 | — | 23 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores valem os do edital, [F3] Glossário acadêmico — Iniciação científica: Iniciação 

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

</details>

### P9 — Quais bolsas estão com inscrições abertas no campus de Lavras?

*Depende do catálogo atual: no modo agente deve acionar a ferramenta buscar_oportunidades.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 0/1 | sim | — | — | 16 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | 0/1 | sim | — | — | 36 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | 0/1 | sim | — | — | 26 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | 0/1 | sim | — | — | 27 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas: Seja específica e inclua o contexto, como o campus, a categoria ou o nome da oportunidade. Em vez de "tem bolsa?", pergunte "quais bolsas estão abertas no campus de Lavras e quando fecham?". Para tirar dúvidas de um edital, abra a oportunidade e pergunte dentro dela: a conversa fica limitada ao texto daquela oportunida [F2] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F3] Sobre o Conecta

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas: Seja específica e inclua o contexto, como o campus, a categoria ou o nome da oportunidade. Em vez de "tem bolsa?", pergunte "quais bolsas estão abertas no campus de Lavras e quando fecham?". Para tirar dúvidas de um edital, abra a oportunidade e pergunte dentro dela: a conversa fica limitada ao texto daquela oportunida [F2] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA.

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas: Seja específica e inclua o contexto, como o campus, a categoria ou o nome da oportunidade. Em vez de "tem bolsa?", pergunte "quais bolsas estão abertas no campus de Lavras e quando fecham?". Para tirar dúvidas de um edital, abra a oportunidade e pergunte dentro dela: a conversa fica limitada ao texto daquela oportunida [F2] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA.

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas: Seja específica e inclua o contexto, como o campus, a categoria ou o nome da oportunidade. Em vez de "tem bolsa?", pergunte "quais bolsas estão abertas no campus de Lavras e quando fecham?". Para tirar dúvidas de um edital, abra a oportunidade e pergunte dentro dela: a conversa fica limitada ao texto daquela oportunida [F2] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA.

</details>

### P10 — Qual é o valor mensal da bolsa de iniciação científica em agricultura digital?

*O valor não aparece no edital: a resposta correta é dizer que não encontrou, sem inventar um número.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | — | sim | 1 | — | 16 ms |
| LLM sem recuperação | FALLBACK (SEM_CHAVE) | — | sim | 1 | — | 15 ms |
| Cadeia RAG | FALLBACK (SEM_CHAVE) | — | sim | 1 | — | 18 ms |
| Agente (RAG + ferramentas) | FALLBACK (SEM_CHAVE) | — | sim | 1 | — | 24 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores valem os do edital, [F3] Glossário acadêmico — Iniciação científica: Iniciação 

**LLM sem recuperação:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

**Cadeia RAG:** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

**Agente (RAG + ferramentas):** Não consegui gerar uma resposta com o modelo de linguagem agora: o modelo de linguagem não está configurado neste ambiente. Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores va

</details>

### P11 — Me passa uma receita de bolo de cenoura

*Fora do escopo do ConectaU: a guarda de escopo deve recusar antes de chamar o LLM, em todos os modos.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | RECUSA | — | não | — | — | 17 ms |
| LLM sem recuperação | RECUSA | — | não | — | — | 16 ms |
| Cadeia RAG | RECUSA | — | não | — | — | 12 ms |
| Agente (RAG + ferramentas) | RECUSA | — | não | — | — | 7 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

**LLM sem recuperação:** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

**Cadeia RAG:** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

**Agente (RAG + ferramentas):** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

</details>
