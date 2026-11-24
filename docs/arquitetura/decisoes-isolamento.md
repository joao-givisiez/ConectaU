# Por que um banco e um container por serviço

> Este documento responde **por que** o ConectaU usa um banco e um container por serviço, e não só **o que** isso significa. Os exemplos usam os serviços reais do projeto ([4.1](4.1-microsservicos.md)).

## Resumo

- Um microsserviço é definido por ser **dono dos próprios dados** e **dono do próprio ciclo de vida**. O banco próprio garante a primeira parte; o container próprio garante a segunda.
- Sem banco próprio, os serviços ficam acoplados pelo esquema das tabelas. O resultado é um *monólito distribuído*: paga-se a latência e a complexidade da rede, mas continua sem ser possível mudar um serviço sem quebrar outro.
- Sem container próprio, não é possível implantar, escalar, limitar ou reiniciar um serviço sem afetar o vizinho.

---

## Parte 1 — Um banco por serviço

### O problema que ele resolve: o esquema vira contrato

Se Oportunidades e Engajamento lessem a mesma tabela `oportunidades`, essa tabela passaria a ser uma API pública — sem versão, sem documentação e sem dono. Renomear a coluna `prazo_inscricao` quebraria o Engajamento em produção, sem nenhum aviso.

Com banco próprio, a única forma de um serviço obter dados de outro é pela **API REST** ou por **eventos**. Ambos são contratos explícitos: versionados (`/api/v1`) e descritos no [`openapi.yaml`](openapi.yaml).

### Razões, com exemplos do ConectaU

| Razão | O que acontece com banco compartilhado | Exemplo no ConectaU |
|---|---|---|
| **Encapsulamento** | O esquema interno vira contrato implícito | Oportunidades pode remodelar a tabela `saga_publicacao` sem avisar nenhum outro serviço |
| **Isolamento de falha e de carga** | Uma consulta pesada ou o esgotamento de conexões afeta todos | A ingestão de editais no Assistente (milhares de inserções de embeddings) não deixa o login da Identidade lento |
| **Tecnologia adequada a cada dado** | Todos são obrigados a usar o mesmo banco | A Coleta guarda documentos de formato variável (MongoDB); o Assistente precisa da extensão `pgvector`; o modelo de leitura do CQRS tem índices de busca textual que a escrita não precisa |
| **Segurança e privacidade (LGPD)** | Qualquer serviço com a credencial lê tudo | Só a Identidade tem credencial do banco com e-mail e hash de senha. O Assistente, que envia texto a um provedor externo de LLM, não consegue ler dados pessoais nem se for manipulado por *prompt injection* |
| **Migração e deploy independentes** | Toda mudança de esquema exige coordenar todos os serviços | O Engajamento cria ou altera a tabela `lembretes` sem janela de manutenção conjunta |
| **Dono único de cada dado** | Dois serviços podem atualizar a mesma linha | O status do candidato só muda dentro da Coleta. Mesmo durante a SAGA, Oportunidades **pede** à Coleta; não grava no banco dela |

### Por que instância separada, e não só um schema separado

Um *schema* por serviço no mesmo servidor PostgreSQL já dá encapsulamento: cada serviço com usuário e permissões próprios. Mas CPU, memória, disco, limite de conexões e o próprio processo do banco continuam compartilhados. Se o servidor cair, todos caem; se o Assistente encher o disco com embeddings, a Identidade para de aceitar cadastros.

A **instância separada** é exigência do trabalho e é o que entrega isolamento de falha de verdade. Em produção, um meio-termo comum é um schema por serviço num cluster gerenciado; aqui usamos instâncias porque, em containers, elas são baratas e tornam o isolamento **visível na demonstração** (um pod de banco por serviço).

### O custo, e como o ConectaU paga por ele

| Custo | Como o ConectaU trata |
|---|---|
| Não existe `JOIN` entre serviços | O BFF compõe as respostas (o feed junta Oportunidades e Engajamento); o Engajamento guarda uma cópia `oportunidade_resumo` |
| Não existe transação ACID entre serviços | SAGA orquestrada com compensações ([4.6](4.6-saga.md)) |
| As cópias ficam defasadas | Consistência eventual com defasagem definida ([4.5](4.5-dados-outbox.md)) |
| Gravar no banco e publicar o evento podem divergir (*dual write*) | Transactional Outbox ([4.5](4.5-dados-outbox.md)) |
| Mais bancos para operar | Imagens próprias com schema de inicialização, volumes e healthchecks padronizados |

A SAGA, a outbox e o CQRS existem **por causa** dessa decisão. Com um banco único, publicar uma oportunidade seria um único `BEGIN … COMMIT` — e não haveria sistema distribuído para demonstrar.

---

## Parte 2 — Um container por serviço

### O problema que ele resolve

O container é a unidade que o Docker e o Kubernetes sabem **iniciar, parar, limitar, reiniciar e replicar**. Se dois serviços dividem um container, toda decisão operacional vale para os dois ao mesmo tempo.

| Razão | O que acontece com dois serviços no mesmo container | Exemplo no ConectaU |
|---|---|---|
| **Escala independente** | Escalar um escala o outro junto | Escalar o BFF Web para 3 réplicas em época de editais não pode criar 3 coletores: a Coleta rodaria 3 vezes e geraria candidatos duplicados |
| **Isolamento de falha** | Um vazamento de memória derruba o vizinho | Se o Assistente estourar a memória numa rajada de perguntas, o Kubernetes encerra só o pod do Assistente (`OOMKilled`); publicação e feed continuam |
| **Limites de recursos** | O limite de CPU e memória vale para o conjunto | O Assistente recebe mais memória que a Identidade em `resources.limits` |
| **Dependências e linguagem próprias** | Bibliotecas e versões entram em conflito | O Assistente pode usar Python e LangChain enquanto os demais usam Node.js, sem disputa de runtime |
| **Deploy e rollback independentes** | Atualizar um exige reiniciar o outro | Corrigir o coletor gera a imagem `coleta:1.4` sem tocar em `identidade:1.2` |
| **Healthcheck honesto** | Com dois processos, um pode morrer e o container continuar "saudável" | O `/health` de cada container responde por exatamente um serviço, e o Kubernetes reinicia o container certo |
| **Menor privilégio** | Credenciais e acessos de rede se somam | O Secret com a senha do banco de Oportunidades só é montado no container de Oportunidades; cada container entra apenas nas redes de que precisa |
| **Observabilidade** | Logs misturados | `docker compose logs assistente` mostra só o Assistente |

### O banco também tem o seu container

Aplicação e banco têm ciclos de vida opostos. A aplicação é **descartável**: pode ser recriada a qualquer momento a partir da imagem. O banco **guarda estado**. Separados, reiniciar ou escalar a aplicação não toca nos dados, e o volume persistente fica ligado apenas ao container do banco (volume nomeado no Compose; StatefulSet com PersistentVolumeClaim no Kubernetes).

### Um processo principal por container

A regra prática é **um processo principal por container**, e não "um serviço inteiro custe o que custar". Por isso o **projetor do CQRS** de Oportunidades roda num container separado da API de Oportunidades, usando a mesma imagem com outro comando:

- a API escala pela demanda HTTP dos estudantes;
- o projetor escala (ou não) pelo tamanho da fila de eventos.

Os dois continuam pertencendo ao mesmo serviço e ao mesmo time.

### O custo

| Custo | Mitigação |
|---|---|
| Mais imagens e mais memória no total | Multi-stage build e imagens `alpine` |
| Chamadas de rede no lugar de chamadas de função | Timeout, retentativa e degradação nos BFFs |
| Mais coisas para subir | Um único `docker compose up` e um único `kubectl apply -k` |

---

## Em uma frase (para a arguição)

> Banco próprio para que nenhum serviço dependa do esquema interno de outro; container próprio para que cada serviço seja implantado, escalado, limitado e reiniciado sozinho. O preço — sem `JOIN`, sem transação global e mais operação — é exatamente o que justifica a SAGA, a outbox e o CQRS no ConectaU.
