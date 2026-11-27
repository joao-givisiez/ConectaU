# Avaliação do RAG — resultados

> Gerado por `scripts/avaliar-rag.mjs` em 2026-11-27 02:23 (UTC), pelo gateway, com as perguntas de [`perguntas-avaliacao.json`](perguntas-avaliacao.json).
> LLM: `openai/gpt-oss-120b` (Groq). Embeddings: `multilingual-e5-small` (local). A metodologia e a análise estão em [`rag-e-agente.md`](rag-e-agente.md#avaliação-do-rag).

## 1. Recuperação (busca vetorial, sem LLM)

Em 4 perguntas com fonte conhecida (a de catálogo depende da ferramenta do agente, e a fora do escopo não tem fonte): **acerto no 1º trecho 100%**, **acerto entre os 3 primeiros 100%**, MRR 1.00.

| Pergunta | Fonte esperada | Posição no top 3 | 1º trecho recuperado | Similaridade |
|---|---|---|---|---|
| P1 Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada? | 04-favoritos-lembretes-e-avisos.md | 1 | Favoritos, lembretes e avisos — Lembretes de prazo | 0.916 |
| P6 Qual a nota mínima e a carga horária exigidas no edital de monitoria de Exatas? | edital: Edital de Monitoria | 1 | Edital de Monitoria — disciplinas de Exatas | 0.921 |
| P7 Quantas vagas tem o Workshop de Docker e Kubernetes e o que devo levar? | edital: Workshop de Docker | 1 | Workshop de Docker e Kubernetes | 0.914 |
| P9 Quais bolsas estão com inscrições abertas no campus de Lavras? | edital: Monitoria | não recuperada | O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas | 0.877 |
| P10 Qual é o valor mensal da bolsa de iniciação científica em agricultura digital? | edital: Iniciação Científica em Agricultura Digital | 1 | Bolsa de Iniciação Científica em Agricultura Digital | 0.925 |
| P11 Me passa uma receita de bolo de cenoura | — | recusada (fora do escopo) | — | — |

## 2. Com e sem recuperação

| Modo | Respostas do LLM | Fatos esperados presentes | Citou fontes | Admitiu não saber (P10) | Recusou fora do escopo (P11) | Latência média | Tokens médios (entrada/saída) | Custo médio |
|---|---|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | — | 83% | — | — | sim | 31 ms | — | — |
| LLM sem recuperação | 5/6 | 0% | 0% | sim | sim | 628 ms | 201 / 98 | US$ 0.000089 |
| Cadeia RAG | 5/6 | 100% | 80% | sim | sim | 675 ms | 784 / 94 | US$ 0.000174 |
| Agente (RAG + ferramentas) | 3/3 | 100% | 67% | sim | — | 1228 ms | 2515 / 206 | US$ 0.000501 |

As respostas passam pela mesma limpeza do Assistente (`limparResposta`: espaços sem quebra, citações `【F1】` ou `[ F1 ]` viram `[F1]`). A avaliação foi feita antes dessa correção, então ela é aplicada aqui às respostas originais da Groq.

"Fatos esperados presentes" conta, em todas as perguntas, quantos fatos da lista `fatos` aparecem no texto da resposta (busca de texto, sem acento). No modo "só recuperação" a resposta é o próprio texto dos trechos devolvidos.

## 3. Pergunta a pergunta

### P1 — Com quanto tempo de antecedência o lembrete me avisa se eu não escolher nada?

*Regra própria do ConectaU (padrão de 48 horas): um modelo sem recuperação não tem como saber.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 1/1 | sim | 1 | — | 42 ms |
| LLM sem recuperação | LLM | 0/1 | não | — | — | 808 ms |
| Cadeia RAG | LLM | 1/1 | sim | 1 | — | 564 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Favoritos, lembretes e avisos — Lembretes de prazo: O lembrete serve para não perder o prazo de inscrição. Ao criar um lembrete, você escolhe com quantas horas de antecedência quer ser avisada, de 1 hora até 720 horas, que são 30 dias. Se você não escolher, o ConectaU usa 48 horas, ou seja, dois dias antes do prazo. Cada pessoa tem no máximo um lembrete por oportunidade [F2] Favoritos, lembretes e avisos — Quando o lembrete dispara: O horário de disparo é o prazo de inscrição menos a antecedência escolhida. Se esse horário já passou, o lembrete dispara imediatamente. Um verificador roda a cada 30 segundos e dispara os lembretes vencidos, gerando um aviso de prazo próximo dentro da plataforma. Depois de disparado, o lembrete não dispara de novo. [F3] Favoritos, lembretes e avisos — Quan

**LLM sem recuperação:** O ConectaU envia o lembrete padrão **24 horas antes** do início da oportunidade caso você não tenha escolhido nenhum horário ou configurado outro aviso. Se quiser mudar esse prazo, basta acessar as **configurações de notificações** no seu perfil e definir o tempo de antecedência que preferir (por exemplo, 48 h, 12 h etc.). Caso ainda não tenha ajustado nada, o aviso de 24 h será o que você receberá.

**Cadeia RAG:** Se você não escolher um tempo de antecedência, o ConectaU usa **48 horas** (ou seja, dois dias) antes do prazo de inscrição. [F1]

</details>

### P6 — Qual a nota mínima e a carga horária exigidas no edital de monitoria de Exatas?

*Dados que só existem no texto do edital indexado pela SAGA.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 2/2 | sim | 1 | — | 45 ms |
| LLM sem recuperação | LLM | 0/2 | não | — | — | 624 ms |
| Cadeia RAG | LLM | 2/2 | sim | 1 | — | 583 ms |
| Agente (RAG + ferramentas) | LLM | 2/2 | sim | 1 | consultar_base_conhecimento | 1024 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Edital de Monitoria — disciplinas de Exatas: Edital de Monitoria — disciplinas de Exatas Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscriçã [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Glossário acadêmico — Monitoria: Monitoria é o apoi

**LLM sem recuperação:** Desculpe, mas não tenho acesso ao edital específico de monitoria de Exatas da UFLA, portanto não consigo informar a nota mínima nem a carga horária exigidas. Recomendo consultar o edital oficial publicado no site da UFLA ou entrar em contato com a coordenação do curso para obter esses detalhes.

**Cadeia RAG:** A nota mínima exigida é **7,0** e a carga horária requerida é **12 horas semanais** de disponibilidade [F1].

**Agente (RAG + ferramentas):** A nota mínima exigida para ser monitor nas disciplinas de Exatas é **7,0** e a carga horária requerida é **12 horas semanais** de disponibilidade [F1].

</details>

### P7 — Quantas vagas tem o Workshop de Docker e Kubernetes e o que devo levar?

*Dados do edital do workshop.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 2/2 | sim | 1 | — | 33 ms |
| LLM sem recuperação | LLM | 0/2 | não | — | — | 532 ms |
| Cadeia RAG | LLM | 2/2 | sim | 1 | — | 673 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Workshop de Docker e Kubernetes: Workshop de Docker e Kubernetes Workshop prático sobre containers e orquestração para a comunidade acadêmica. Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado. Categoria: EVENTO. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: 2026-12-11. [F2] Como participar de uma oportunidade — O que costuma ser pedido: Os documentos variam por edital, mas é comum pedirem histórico escolar, comprovante de matrícula, carta de interesse, currículo e, em seleções de monitoria, a nota obtida na disciplina. Alguns editais exigem número mínimo de horas semanais de dedicação. Confira sempre a lista completa no edital oficial. [F3] Sobre o ConectaU — O que a pessoa consegue fazer na plataforma: - Criar uma conta inform

**LLM sem recuperação:** Desculpe, mas não tenho informações específicas sobre o número de vagas nem sobre o que levar para o Workshop de Docker e Kubernetes. Recomendo consultar o anúncio oficial da oportunidade (site, redes sociais ou canal de comunicação da UFLA) para obter esses detalhes.

**Cadeia RAG:** O Workshop de Docker e Kubernetes tem **40 vagas** disponíveis. Para participar, é necessário **trazer o notebook com o Docker já instalado**. Fonte: [F1]

</details>

### P9 — Quais bolsas estão com inscrições abertas no campus de Lavras?

*Depende do catálogo atual: no modo agente deve acionar a ferramenta buscar_oportunidades.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | 0/1 | sim | — | — | 31 ms |
| LLM sem recuperação | LLM | 0/1 | não | — | — | 626 ms |
| Cadeia RAG | LLM | 1/1 | sim | 5 | — | 916 ms |
| Agente (RAG + ferramentas) | LLM | 1/1 | sim | 1 | buscar_oportunidades | 1532 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] O assistente do ConectaU e seus limites — Dicas para fazer boas perguntas: Seja específica e inclua o contexto, como o campus, a categoria ou o nome da oportunidade. Em vez de "tem bolsa?", pergunte "quais bolsas estão abertas no campus de Lavras e quando fecham?". Para tirar dúvidas de um edital, abra a oportunidade e pergunte dentro dela: a conversa fica limitada ao texto daquela oportunida [F2] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F3] Sobre o Conecta

**LLM sem recuperação:** Desculpe, mas não tenho informações atualizadas sobre bolsas com inscrições abertas no campus de Lavras neste momento. Recomendo consultar o site oficial da UFLA, a página de bolsas da Pró-Reitoria de Extensão ou os canais de comunicação do campus (como o portal ConectaU, redes sociais ou murais de avisos) para obter a lista mais recente.

**Cadeia RAG:** - Bolsa de Iniciação Científica em Agricultura Digital – inscrições até 2026-12-11 [F2] - Edital de Monitoria – disciplinas de Exatas – inscrições até 2026-12-11 [F5] Ambas são oportunidades da categoria **BOLSA** e estão vinculadas ao campus de **Lavras**. Para se inscrever, acesse o canal oficial indicado nos editais.

**Agente (RAG + ferramentas):** **Bolsas com inscrições abertas no campus de Lavras (até 11/12/2026):** 1. **Edital de Monitoria – disciplinas de Exatas** - Prazo: 11 de dezembro de 2026 (faltam 15 dias) - Início: 16 de dezembro de 2026 - Requisitos: ter cursado a disciplina com nota mínima 7,0 e disponibilidade de 12 h/semana; bolsa por 4 meses. - Inscrição: pelo sistema acadêmico. - Fonte: https://ufla.br/ [F1] 2. **Bolsa de Iniciação Científica em Agricultura Digital** - Prazo: 11 de dezembro de 2026 (faltam 15 dias) - Início: 16 de dezembro de 2026 - Projeto: sensores e aprendizado de máquina para manejo de lavouras; bolsa de 12 meses com dedicação de 20 h/semana. - Documentos: histórico escolar e carta de interesse. - Fonte: https://ufla.br/ [F2] *Lembre-se de acessar o canal oficial indicado em cada edital para efetuar a inscrição.*

</details>

### P10 — Qual é o valor mensal da bolsa de iniciação científica em agricultura digital?

*O valor não aparece no edital: a resposta correta é dizer que não encontrou, sem inventar um número.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | FALLBACK (SOLICITADO) | — | sim | 1 | — | 25 ms |
| LLM sem recuperação | LLM | — | não | — | — | 548 ms |
| Cadeia RAG | LLM | — | não | 1 | — | 639 ms |
| Agente (RAG + ferramentas) | LLM | — | não | 1 | consultar_base_conhecimento | 1128 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Modo de recuperação (sem modelo de linguagem). Estes são os trechos mais relevantes que encontrei: [F1] Bolsa de Iniciação Científica em Agricultura Digital: Bolsa de Iniciação Científica em Agricultura Digital Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse. Categoria: BOLSA. Campus: LAVRAS. Início: 2026-12-16. Prazo de inscrição: [F2] Categorias de oportunidade — Bolsa: Bolsa é uma oportunidade com auxílio financeiro, como iniciação científica, monitoria remunerada, extensão ou desenvolvimento tecnológico. Cada edital define o valor, a duração, a carga horária semanal e os requisitos. O ConectaU divulga a bolsa e aponta para o edital oficial; as regras e os valores valem os do edital, [F3] Glossário acadêmico — Iniciação científica: Iniciação 

**LLM sem recuperação:** Não tenho informação atualizada sobre o valor mensal da bolsa de iniciação científica em agricultura digital na UFLA. Recomendo consultar a página da Pró-Reitoria de Pesquisa ou o edital específico da bolsa, que costuma detalhar o valor e as condições. Caso precise, posso ajudar a encontrar esses recursos.

**Cadeia RAG:** Não encontrei informação sobre o valor mensal da bolsa de iniciação científica em Agricultura Digital nos trechos disponíveis. Recomendo consultar o edital oficial da oportunidade (fonte: https://ufla.br/) para obter esse detalhe.

**Agente (RAG + ferramentas):** Não encontrei no edital publicado o valor mensal da bolsa de Iniciação Científica em Agricultura Digital. Recomendo consultar o edital completo no canal oficial indicado (https://ufla.br/) para obter essa informação.

</details>

### P11 — Me passa uma receita de bolo de cenoura

*Fora do escopo do ConectaU: a guarda de escopo deve recusar antes de chamar o LLM, em todos os modos.*

| Modo | Origem | Fatos | Citou | Fonte esperada (posição) | Ferramentas | Latência |
|---|---|---|---|---|---|---|
| Só recuperação (sem LLM) | RECUSA | — | não | — | — | 8 ms |
| LLM sem recuperação | RECUSA | — | não | — | — | 9 ms |
| Cadeia RAG | RECUSA | — | não | — | — | 14 ms |

<details><summary>Respostas</summary>

**Só recuperação (sem LLM):** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

**LLM sem recuperação:** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

**Cadeia RAG:** Só posso ajudar com assuntos do ConectaU: oportunidades da UFLA (eventos, atividades, bolsas, projetos e processos seletivos), editais, prazos de inscrição, favoritos, lembretes, avisos e o funcionamento da plataforma. Reformule a sua pergunta sobre um desses temas.

</details>
