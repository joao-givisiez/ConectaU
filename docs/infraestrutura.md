# Infraestrutura — containerização e orquestração (Parte 3)

> Como o ConectaU é empacotado em imagens, executado com Docker Compose e orquestrado no Kubernetes.
> Para subir o sistema, siga o [README](../README.md#-execução-e-infraestrutura). O porquê de usar um banco e um container
> por serviço está em [decisoes-isolamento.md](arquitetura/decisoes-isolamento.md).

## 1. Componentes e imagens

São **18 containers**: 5 serviços de domínio (Oportunidades em dois processos), 2 BFFs, 2 clientes, o gateway, 6 bancos e o broker.

| Componente | Imagem | Dockerfile | Porta | Base |
|---|---|---|---|---|
| Gateway (Traefik) | `conectau/gateway` | [infrastructure/docker/gateway](../infrastructure/docker/gateway/Dockerfile) | 8000 | `traefik:v3.7` + regras de roteamento |
| Portal Web | `conectau/portal-web` | [clients/portal-web](../clients/portal-web/Dockerfile) | 8080 | `nginx-unprivileged` + arquivos estáticos |
| Painel Admin | `conectau/painel-admin` | [clients/painel-admin](../clients/painel-admin/Dockerfile) | 8080 | `nginx-unprivileged` + arquivos estáticos |
| BFF Web | `conectau/bff-web` | [bffs/bff-web](../bffs/bff-web/Dockerfile) | 3201 | `node:22-alpine`, multi-stage |
| BFF Admin | `conectau/bff-admin` | [bffs/bff-admin](../bffs/bff-admin/Dockerfile) | 3202 | `node:22-alpine`, multi-stage |
| Identidade | `conectau/identidade` | [services/identidade](../services/identidade/Dockerfile) | 3101 | `node:22-alpine`, multi-stage |
| Coleta | `conectau/coleta` | [services/coleta](../services/coleta/Dockerfile) | 3102 | `node:22-alpine`, multi-stage |
| Oportunidades (API + SAGA + relay) | `conectau/oportunidades` | [services/oportunidades](../services/oportunidades/Dockerfile) | 3103 | `node:22-alpine`, multi-stage |
| Oportunidades — projetor CQRS | `conectau/oportunidades` (outro comando) | idem | 3113 | idem |
| Engajamento | `conectau/engajamento` | [services/engajamento](../services/engajamento/Dockerfile) | 3104 | `node:22-alpine`, multi-stage |
| Assistente | `conectau/assistente` | [services/assistente](../services/assistente/Dockerfile) | 3105 | `node:22-slim`, multi-stage em 3 estágios, com o modelo de embeddings embutido |
| Bancos PostgreSQL (5) | `conectau/<serviço>-db` | [infrastructure/docker/postgres](../infrastructure/docker/postgres/Dockerfile) | 5432 | `postgres:17-alpine` (Assistente: `pgvector/pgvector:pg17`) + esquema do serviço |
| Banco MongoDB | `conectau/coleta-db` | [infrastructure/docker/mongo](../infrastructure/docker/mongo/Dockerfile) | 27017 | `mongo:8.0` + usuário e índices |
| RabbitMQ | `conectau/rabbitmq` | [infrastructure/docker/rabbitmq](../infrastructure/docker/rabbitmq/Dockerfile) | 5672 / 15672 | `rabbitmq:4.1-management-alpine` + configuração |

Nenhuma imagem de terceiros é usada sem customização: cada banco recebe o esquema do seu serviço (executado na primeira subida), o MongoDB cria um usuário de menor privilégio, o RabbitMQ recebe configuração própria e o gateway recebe as regras de roteamento.

## 2. Multi-stage build

Os 7 componentes em Node.js usam dois estágios:

| Estágio | O que contém | Tamanho em disco (Identidade) |
|---|---|---|
| `build` | `node_modules` completo (TypeScript, esbuild, tipos), código-fonte de todos os workspaces; roda `typecheck` e empacota o serviço com esbuild | 326 MB |
| `execucao` (imagem final) | Apenas `node:22-alpine` e **um arquivo** `dist/index.cjs` (~1,6 MB) com o serviço e o código compartilhado | 241 MB, dos quais ~1,6 MB são do serviço |

**Ganho:** a imagem final não leva compilador, `node_modules`, código-fonte nem dependências de desenvolvimento — menos superfície de ataque e menos camadas para baixar a cada nova versão (só a camada de ~1,6 MB muda entre versões). A verificação de tipos roda no build: uma imagem com erro de tipo não chega a ser gerada.

O **Assistente** usa três estágios e `node:22-slim` (Debian) em vez de Alpine, porque o modelo de embeddings roda no ONNX Runtime, cujos binários nativos exigem glibc:

| Estágio | O que faz |
|---|---|
| `build` | Instala só as dependências do Assistente, verifica os tipos e empacota o código; as bibliotecas nativas ficam fora do arquivo |
| `nativos` | Instala o ONNX Runtime (só os binários de Linux) e **baixa o modelo** `multilingual-e5-small` (~130 MB), testando que ele gera vetores de 384 posições |
| `execucao` | Node.js + arquivo empacotado + bibliotecas nativas + modelo + base de conhecimento. O container sobe **sem acesso à internet** e o modelo carrega em ~1,3 s |

A imagem fica com 753 MB (o ONNX Runtime e o modelo respondem por ~270 MB). Em troca, o embedding não depende de uma API externa paga nem falível.

Os outros serviços Node instalam no estágio de build **só as dependências do próprio workspace** (`npm ci --workspace=...`), para não baixar o ONNX Runtime à toa.

Os clientes **não** usam multi-stage porque são HTML, CSS e JavaScript puros, sem etapa de compilação; um estágio de build não teria o que fazer. Os bancos também não, porque só acrescentam arquivos de inicialização à imagem oficial.

Outras práticas aplicadas: processo rodando como usuário sem privilégios (`USER node`, `nginx-unprivileged`), `HEALTHCHECK` em todas as imagens, imagens base fixadas na versão principal (`node:22-alpine`, `postgres:17-alpine`, `mongo:8.0`, `traefik:v3.7`), `.dockerignore` que impede segredos (`.env`) e documentação de entrarem no contexto de build, e cache de dependências com `--mount=type=cache`.

## 3. Docker Compose

Um único comando sobe o sistema inteiro: `docker compose up -d --build` ([docker-compose.yml](../docker-compose.yml)).

### Redes — isolamento por camada

| Rede | Quem participa | Por quê |
|---|---|---|
| `rede-borda` | gateway, clientes, BFFs, Identidade | Única camada alcançável pelo gateway; Identidade está aqui para login e verificação de token |
| `rede-aplicacao` *(internal)* | BFFs e os 5 serviços | O gateway **não** está nela: não alcança Coleta, Oportunidades nem as rotas `/internal/**` |
| `rede-mensageria` *(internal)* | RabbitMQ, Oportunidades, projetor, Engajamento, Assistente | Só quem publica ou consome eventos |
| `rede-dados-<serviço>` *(internal)* | um banco e o seu serviço | **Um banco por rede**: nenhum serviço alcança o banco de outro, nem por engano |
| `rede-gerencia` | RabbitMQ | Apenas para publicar o painel do RabbitMQ em `127.0.0.1:15672` |
| `rede-saida` | Assistente | **Única rede com saída para a internet**, para chamar o provedor de LLM (Groq). Nenhum outro serviço consegue falar com fora |

Redes `internal: true` não têm saída para a internet; a `rede-saida` é a exceção, e só o Assistente participa dela. Só o gateway (8080) e os painéis de gerência (8081 e 15672, presos a `127.0.0.1`) são publicados no host.

### Volumes — persistência

Cada banco tem um volume nomeado (`identidade-dados`, `coleta-dados`, `oportunidades-dados`, `oportunidades-leitura-dados`, `engajamento-dados`, `assistente-dados`, `rabbitmq-dados`). `docker compose down` preserva os dados; `docker compose down -v` apaga tudo (necessário para reexecutar os esquemas de inicialização).

### Ordem de subida

Os serviços esperam seus bancos ficarem saudáveis (`depends_on` com `condition: service_healthy`, usando os `HEALTHCHECK` das imagens). Além disso, todo serviço tolera dependências fora do ar: o consumidor de eventos reconecta ao RabbitMQ, a Coleta tenta o MongoDB de novo e o `/health` responde 503 enquanto o banco não está pronto.

## 4. Kubernetes

Tudo sobe com `kubectl apply -k infrastructure/kubernetes` ([kustomization.yaml](../infrastructure/kubernetes/kustomization.yaml)), no namespace `conectau`.

| Recurso | Arquivo | O que contém |
|---|---|---|
| Deployments + Services | [servicos.yaml](../infrastructure/kubernetes/servicos.yaml) | 10 Deployments (5 serviços, o projetor, 2 BFFs, 2 clientes), todos com `resources`, readiness em `/health` e liveness por TCP. São 9 Services ClusterIP: o projetor não tem Service porque não recebe requisições, só consome eventos do RabbitMQ |
| StatefulSets + Services | [bancos.yaml](../infrastructure/kubernetes/bancos.yaml) | 7 StatefulSets (6 bancos e o RabbitMQ), cada um com o próprio PersistentVolumeClaim (`volumeClaimTemplates`) |
| ConfigMaps | [configmaps.yaml](../infrastructure/kubernetes/configmaps.yaml) | 8 ConfigMaps, um para cada processo Node (5 serviços, o projetor e os 2 BFFs), só com configuração não sensível (hosts, nomes de banco, URLs internas). Os clientes não precisam de configuração |
| Secret | gerado de `segredos.env` | Senhas dos bancos, `JWT_SEGREDO`, `TOKEN_SERVICO`, credenciais do admin e do RabbitMQ. O arquivo real é ignorado pelo Git; só o [exemplo](../infrastructure/kubernetes/segredos.env.example) é versionado |
| Ingress + Middlewares | [gateway.yaml](../infrastructure/kubernetes/gateway.yaml) | As mesmas regras do gateway do Compose, aplicadas pelo Traefik do cluster: `/auth`, `/web`, `/admin`, `/painel` e `/` |

Decisões que valem mencionar na arguição:

- **Liveness × readiness:** a readiness usa `/health`, que falha quando o banco está fora, e tira o pod do balanceamento; a liveness só verifica a porta, para que um banco fora do ar não faça o Kubernetes reiniciar o serviço em loop.
- **Segredos em URL:** `MONGO_URL` e `RABBITMQ_URL` são montadas com a substituição `$(VAR)` do Kubernetes, sem copiar a senha para o ConfigMap.
- **Hash no nome do Secret:** o `secretGenerator` acrescenta um sufixo de hash; mudar um segredo recria os pods automaticamente.
- **Chave do LLM opcional:** `GROQ_API_KEY` entra no Secret com `optional: true`. Sem a chave o pod sobe e o assistente responde em modo de recuperação.
- **Memória do Assistente:** pede 512 Mi e tem limite de 1 Gi, por causa do modelo de embeddings; a readiness só passa depois de carregar o modelo e ingerir a base de conhecimento.

## 5. Demonstração de escalabilidade

```powershell
kubectl scale deployment bff-web -n conectau --replicas=4
kubectl scale deployment oportunidades -n conectau --replicas=3
kubectl get pods -n conectau -l app=oportunidades
```

Escalar **Oportunidades** é o caso mais interessante, porque cada réplica tem um worker da SAGA e um relay da outbox disputando o mesmo banco. A coordenação é feita no próprio PostgreSQL, com `FOR UPDATE SKIP LOCKED`: cada SAGA e cada lote da outbox é reservado por uma única réplica. Num teste com 3 réplicas, uma publicação teve todos os passos executados por uma só delas, sem duplicação (confira com `kubectl logs` em cada pod).

Também é seguro escalar a Coleta: se várias réplicas coletarem a mesma fonte, o índice único do hash de título e data impede candidatos duplicados.

Bancos não são escalados horizontalmente (1 réplica por StatefulSet): replicação de banco está fora do escopo do trabalho.

## 6. Verificação de ponta a ponta

[`scripts/demonstracao.mjs`](../scripts/demonstracao.mjs) percorre o sistema pelo gateway, como um cliente real, e confere cada etapa. A numeração abaixo é a mesma que o roteiro imprime na tela:

1. Clientes servidos pelo gateway.
2. Login do administrador (gateway → Identidade, JWT).
3. Fila de curadoria: candidatos `PENDENTE` vindos da Coleta (MongoDB).
4. Cadastro de oportunidade em `RASCUNHO` com links HATEOAS.
5. **SAGA — caminho feliz** (Oportunidades → Coleta → Assistente → pivô).
6. **CQRS** — a busca pública reflete a publicação após alguns centésimos de segundo.
7. Estudante: cadastro, login e feed do BFF Web filtrado pelo perfil.
8. BFF: a mesma oportunidade vista por cada cliente.
9. Engajamento: favorito, favorito duplicado (409) e lembrete.
10. **Assistente (RAG + agente LangChain):** pergunta sobre o funcionamento (base de conhecimento), sobre um edital (trecho indexado pela SAGA), sobre o catálogo (ferramenta `buscar_oportunidades`) e só com recuperação.
11. Segurança: 401 sem token, 403 com papel errado, cabeçalho `X-Usuario-*` forjado descartado pelo gateway.
12. **SAGA com falha** — o Assistente é derrubado; a SAGA compensa, o candidato volta a `PENDENTE` e a oportunidade a `RASCUNHO`.
13. **LLM como dependência falível:** falha injetada no provedor; as respostas caem no fallback, o circuito abre depois de 3 falhas e, com a chave configurada, fecha de novo quando o provedor volta.
14. Encerramento: o projetor remove a oportunidade da busca, o Engajamento avisa quem a salvou e o Assistente tira o edital do índice.

```powershell
node scripts/demonstracao.mjs                                              # Docker Compose
node scripts/demonstracao.mjs --url=http://localhost:8090 --falha=k8s      # Kubernetes
```

## 7. Parte 4: o Assistente com LLM

Na Parte 4 o Assistente passou a gerar respostas com um LLM (Groq), por um agente LangChain com ferramentas, sobre uma base de conhecimento própria e os editais indexados. O LLM é tratado como dependência falível: circuit breaker, retentativa com backoff, cache e fallback. O desenho, as medições de latência e custo e a avaliação estão em [`parte-4/rag-e-agente.md`](parte-4/rag-e-agente.md).

Na infraestrutura, isso trouxe:

- a imagem do Assistente em três estágios, com o modelo de embeddings embutido (seção 2);
- a `rede-saida`, a única com acesso à internet (seção 3);
- o Assistente na `rede-mensageria`, consumindo os eventos de edição e encerramento para manter o índice em dia;
- a variável `GROQ_API_KEY`, a única a preencher; sem ela, tudo funciona e o assistente responde em modo de recuperação.
