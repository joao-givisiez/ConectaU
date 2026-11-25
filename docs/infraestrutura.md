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
| Assistente | `conectau/assistente` | [services/assistente](../services/assistente/Dockerfile) | 3105 | `node:22-alpine`, multi-stage |
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

Os clientes **não** usam multi-stage porque são HTML, CSS e JavaScript puros, sem etapa de compilação; um estágio de build não teria o que fazer. Os bancos também não, porque só acrescentam arquivos de inicialização à imagem oficial.

Outras práticas aplicadas: processo rodando como usuário sem privilégios (`USER node`, `nginx-unprivileged`), `HEALTHCHECK` em todas as imagens, imagens base fixadas na versão principal (`node:22-alpine`, `postgres:17-alpine`, `mongo:8.0`, `traefik:v3.7`), `.dockerignore` que impede segredos (`.env`) e documentação de entrarem no contexto de build, e cache de dependências com `--mount=type=cache`.

## 3. Docker Compose

Um único comando sobe o sistema inteiro: `docker compose up -d --build` ([docker-compose.yml](../docker-compose.yml)).

### Redes — isolamento por camada

| Rede | Quem participa | Por quê |
|---|---|---|
| `rede-borda` | gateway, clientes, BFFs, Identidade | Única camada alcançável pelo gateway; Identidade está aqui para login e verificação de token |
| `rede-aplicacao` *(internal)* | BFFs e os 5 serviços | O gateway **não** está nela: não alcança Coleta, Oportunidades nem as rotas `/internal/**` |
| `rede-mensageria` *(internal)* | RabbitMQ, Oportunidades, projetor, Engajamento | Só quem publica ou consome eventos |
| `rede-dados-<serviço>` *(internal)* | um banco e o seu serviço | **Um banco por rede**: nenhum serviço alcança o banco de outro, nem por engano |
| `rede-gerencia` | RabbitMQ | Apenas para publicar o painel do RabbitMQ em `127.0.0.1:15672` |

Redes `internal: true` não têm saída para a internet. Só o gateway (8080) e os painéis de gerência (8081 e 15672, presos a `127.0.0.1`) são publicados no host.

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
10. Assistente: busca vetorial no pgvector sobre o texto indexado pela SAGA.
11. Segurança: 401 sem token, 403 com papel errado, cabeçalho `X-Usuario-*` forjado descartado pelo gateway.
12. **SAGA com falha** — o Assistente é derrubado; a SAGA compensa, o candidato volta a `PENDENTE` e a oportunidade a `RASCUNHO`.
13. Encerramento: o projetor remove a oportunidade da busca e o Engajamento avisa quem a salvou.

```powershell
node scripts/demonstracao.mjs                                              # Docker Compose
node scripts/demonstracao.mjs --url=http://localhost:8090 --falha=k8s      # Kubernetes
```

## 7. O que fica para a Parte 4

O Assistente já indexa os editais no pgvector e faz a recuperação por similaridade, mas ainda **não gera respostas com um LLM**: as respostas saem em modo de recuperação (`degradada: true`), com os trechos mais relevantes e suas citações. Nesta etapa, os embeddings são calculados localmente (vetor de 256 posições por *hashing* de palavras, sem rede). Na Parte 4 entram o provedor de LLM e de embeddings, o LangChain (chains e tool), os mecanismos de resiliência e a avaliação do RAG.
