<p align="center">
  <img src="docs/imagens/logo.png" alt="ConectaU" width="520">
</p>

<h3 align="center">Descubra, participe, conecte-se.</h3>

<p align="center">
  <a href="docker-compose.yml"><b>🐳 docker-compose.yml</b></a> ·
  <a href="#-dockerfiles"><b>📦 Dockerfiles</b></a> ·
  <a href="docs/arquitetura/ARQUITETURA-CONECTAU.md"><b>🏗️ Arquitetura</b></a> ·
  <a href="SISTEMA.md"><b>📘 Como funciona</b></a> ·
  <a href="docs/arquitetura/openapi.yaml"><b>📄 OpenAPI</b></a> ·
  <a href="infrastructure/kubernetes/"><b>☸️ Kubernetes</b></a> ·
  <a href="#-roteiro-da-demonstração"><b>▶️ Demonstração</b></a>
</p>

---

## ❗ O problema

A UFLA divulga muitas oportunidades (eventos, bolsas, projetos, processos seletivos), mas elas ficam espalhadas por e-mail, redes sociais, grupos, sites e o SIG. Quem poderia participar **descobre tarde demais**.

O **ConectaU** reúne essas oportunidades num só lugar, filtra pelo perfil de cada pessoa e lembra dos prazos. A inscrição continua no canal oficial: o ConectaU resolve a **descoberta**.

Problema, pesquisa, impacto social e referências completas: [`docs/README-COMPLETO.md`](docs/README-COMPLETO.md).

## 👥 Equipe

| Integrante | Função |
|---|---|
| Guilherme Alexandre Cunha Silva | Scrum Master |
| Gustavo de Assis Vieira | Desenvolvedor |
| João Vitor Givisiez Lessa | Desenvolvedor |
| Maria Luiza Santos Ferreira | Product Owner |

---

## 🔎 Acesso

Os arquivos mais pedidos na apresentação, a um clique.

| Requisito | Clique aqui |
|---|---|
| **docker-compose.yml** | [`docker-compose.yml`](docker-compose.yml) · [serviços](docker-compose.yml#L25) · [volumes](docker-compose.yml#L310) · [redes](docker-compose.yml#L319) |
| **Dockerfile** de um serviço | [tabela de Dockerfiles](#-dockerfiles) |
| **Arquitetura** (diagrama integrado) | [`ARQUITETURA-CONECTAU.md`](docs/arquitetura/ARQUITETURA-CONECTAU.md) |
| **Como o sistema funciona** de ponta a ponta | [`SISTEMA.md`](SISTEMA.md) |
| **Contrato da API** (OpenAPI) | [`openapi.yaml`](docs/arquitetura/openapi.yaml) · [tabela de endpoints](docs/arquitetura/4.2-api-rest.md) |
| **Manifests do Kubernetes** | [`infrastructure/kubernetes/`](infrastructure/kubernetes/) |
| **Vídeos** | [Entrega da Parte 3](https://drive.google.com/drive/folders/1_DyPLt6FhXqFV3msJlyv8K-zaNSfAilI?usp=sharing) · [Apresentação da Parte 4](https://drive.google.com/drive/folders/1RMfmpTee2t_p9UVo2xa4N_pcoxAWNv33?usp=sharing) |
| **Variáveis de ambiente** (modelo do `.env`) | [`.env.example`](.env.example) |

---

## ✅ Requisitos da Parte 4

> 🎥 **Vídeo da apresentação da Parte 4:** [assista no Google Drive](https://drive.google.com/drive/folders/1RMfmpTee2t_p9UVo2xa4N_pcoxAWNv33?usp=sharing)

Cada linha leva direto ao trecho do código que implementa o requisito e ao documento que explica a decisão.

### 6.1 Sistema distribuído funcional

Toda requisição entra pelo **API Gateway** (Traefik), que confere o login e limita o número de requisições. Depois ela passa pelo **BFF** do cliente (Portal Web ou Painel Admin) e chega aos serviços de domínio.

Publicar uma oportunidade é a **SAGA**: o serviço Oportunidades coordena 3 passos em 3 serviços. Primeiro marca o candidato como usado na Coleta, depois indexa o texto no Assistente e por fim publica. Se um passo falha, os anteriores são desfeitos (**compensação**) e a oportunidade volta para rascunho.

O catálogo usa **CQRS**: as escritas vão para um banco e as buscas leem de outro, atualizado por eventos. A **outbox** garante que nenhum evento se perde, porque ele é gravado na mesma transação da escrita e só depois enviado ao RabbitMQ.

| Requisito | Código | Documento |
|---|---|---|
| Fluxo de ponta a ponta (gateway → BFF → serviços) | [rotas do gateway](infrastructure/docker/gateway/dinamico.yml#L11) · [BFF Web](bffs/bff-web/src/index.ts) · [BFF Admin](bffs/bff-admin/src/index.ts) | [SISTEMA.md §11](SISTEMA.md#11-dois-fluxos-completos-passo-a-passo) |
| **SAGA** orquestrada (publicação) | [orquestrador](services/oportunidades/src/saga.ts#L51) · [execução dos passos](services/oportunidades/src/saga.ts#L99) | [4.6-saga.md](docs/arquitetura/4.6-saga.md) |
| **Compensação** da SAGA | [compensar()](services/oportunidades/src/saga.ts#L180) · [compensação de cada passo](services/oportunidades/src/saga.ts#L163) | [4.6-saga.md](docs/arquitetura/4.6-saga.md) |
| **CQRS** (escrita × leitura) | [projetor do modelo de leitura](services/oportunidades/src/projetor.ts#L37) · [banco de escrita](services/oportunidades/db/escrita.sql) · [banco de leitura](services/oportunidades/db/leitura.sql) | [4.7-cqrs.md](docs/arquitetura/4.7-cqrs.md) |
| **Outbox** | [tabela outbox](services/oportunidades/db/escrita.sql#L56) · [relay](services/oportunidades/src/relay.ts#L18) | [4.5-dados-outbox.md](docs/arquitetura/4.5-dados-outbox.md) |
| **Bancos separados** por serviço | [bancos no Compose](docker-compose.yml#L25) | [decisoes-isolamento.md](docs/arquitetura/decisoes-isolamento.md) |

### 6.2 Integração de LLM

O **Assistente** responde perguntas sobre o ConectaU e sobre os editais publicados. No **RAG**, ele transforma os textos em vetores (embeddings), guarda no PostgreSQL com pgvector, busca os trechos mais parecidos com a pergunta e só então pede a resposta ao LLM (Groq), citando as fontes.

Com o **LangChain**, o fluxo é montado em chains, e o agente tem duas **tools** que consultam dados reais do sistema: a base de conhecimento e o catálogo de oportunidades.

Como o LLM é um serviço externo que pode falhar, ele é protegido por **disjuntor**, **retentativa com backoff**, **cache** e **fallback**. Quando o LLM cai, o assistente continua respondendo com os trechos encontrados, sem texto gerado.

| Requisito | Código | Documento |
|---|---|---|
| **RAG: ingestão** da base de conhecimento | [ingerirConhecimento()](services/assistente/src/conhecimento.ts#L42) · [documentos da base](services/assistente/conhecimento/) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **RAG: embeddings** | [embeddings.ts](services/assistente/src/embeddings.ts#L33) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **RAG: base vetorial** (pgvector) | [tabelas `vector(384)`](services/assistente/db/init.sql#L17) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **RAG: recuperação** | [recuperar()](services/assistente/src/recuperacao.ts#L40) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **RAG: geração** | [cadeia RAG](services/assistente/src/cadeias.ts#L117) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **Avaliação do RAG** (com × sem recuperação) | [script](scripts/avaliar-rag.mjs) · [perguntas](docs/parte-4/perguntas-avaliacao.json) | [avaliacao-rag.md](docs/parte-4/avaliacao-rag.md) · [análise](docs/parte-4/rag-e-agente.md#9-avaliação-do-rag) |
| **LangChain: chains** | [RunnableSequence](services/assistente/src/cadeias.ts#L103) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **LangChain: tools** (dados reais do sistema) | [consultar_base_conhecimento](services/assistente/src/ferramentas.ts#L99) · [buscar_oportunidades](services/assistente/src/ferramentas.ts#L127) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| Agente (opcional) | [createAgent](services/assistente/src/cadeias.ts#L131) | [rag-e-agente.md](docs/parte-4/rag-e-agente.md) |
| **Circuit breaker** | [classe Disjuntor](services/assistente/src/resiliencia.ts#L47) | [rag-e-agente.md §7](docs/parte-4/rag-e-agente.md) |
| **Timeout e retry com backoff** | [comRetentativas()](services/assistente/src/resiliencia.ts#L205) · [timeout](services/assistente/src/llm.ts#L54) | [rag-e-agente.md §7](docs/parte-4/rag-e-agente.md) |
| **Cache** das respostas | [cache.ts](services/assistente/src/cache.ts#L45) | [rag-e-agente.md §7](docs/parte-4/rag-e-agente.md) |
| **Fallback** sem o LLM | [fallback de recuperação](services/assistente/src/perguntar.ts#L202) | [rag-e-agente.md §7](docs/parte-4/rag-e-agente.md) |
| **Latência e custo** | [métricas](services/assistente/src/metricas.ts#L28) · [custo por chamada](services/assistente/src/llm.ts#L81) | [rag-e-agente.md §8](docs/parte-4/rag-e-agente.md#8-latência-e-custo) |

### Partes anteriores

| Parte | Onde |
|---|---|
| Parte 2: microsserviços, REST/HATEOAS, gateway, BFF, dados, SAGA, CQRS | [`docs/arquitetura/`](docs/arquitetura/) · [HATEOAS no código](services/oportunidades/src/modelo.ts#L100) |
| Parte 3: Docker, Compose e Kubernetes | [`docs/infraestrutura.md`](docs/infraestrutura.md) |

---

## 📦 Dockerfiles

Todos os serviços usam **Dockerfile próprio**. Os serviços Node usam **multi-stage build**: compilam numa etapa e levam só o resultado para a imagem final, que fica menor e sem ferramentas de build.

| Componente | Dockerfile | Multi-stage |
|---|---|---|
| Identidade | [`services/identidade/Dockerfile`](services/identidade/Dockerfile) | ✔ |
| Coleta | [`services/coleta/Dockerfile`](services/coleta/Dockerfile) | ✔ |
| Oportunidades (API e projetor) | [`services/oportunidades/Dockerfile`](services/oportunidades/Dockerfile) | ✔ |
| Engajamento | [`services/engajamento/Dockerfile`](services/engajamento/Dockerfile) | ✔ |
| Assistente (RAG + LLM) | [`services/assistente/Dockerfile`](services/assistente/Dockerfile) | ✔ (3 etapas) |
| BFF Web | [`bffs/bff-web/Dockerfile`](bffs/bff-web/Dockerfile) | ✔ |
| BFF Admin | [`bffs/bff-admin/Dockerfile`](bffs/bff-admin/Dockerfile) | ✔ |
| Portal Web (nginx) | [`clients/portal-web/Dockerfile`](clients/portal-web/Dockerfile) | — |
| Painel Admin (nginx) | [`clients/painel-admin/Dockerfile`](clients/painel-admin/Dockerfile) | — |
| API Gateway (Traefik) | [`infrastructure/docker/gateway/Dockerfile`](infrastructure/docker/gateway/Dockerfile) | — |
| PostgreSQL (5 bancos, 1 com pgvector) | [`infrastructure/docker/postgres/Dockerfile`](infrastructure/docker/postgres/Dockerfile) | — |
| MongoDB (Coleta) | [`infrastructure/docker/mongo/Dockerfile`](infrastructure/docker/mongo/Dockerfile) | — |
| RabbitMQ | [`infrastructure/docker/rabbitmq/Dockerfile`](infrastructure/docker/rabbitmq/Dockerfile) | — |

---

## 🚀 Execução e infraestrutura

Pré-requisitos: Docker Desktop e as portas 8080, 8081 e 15672 livres.

```powershell
Copy-Item .env.example .env      # depois preencha os valores (GROQ_API_KEY para o LLM)
docker compose up -d --build
docker compose ps                 # todos "healthy" em ~1 minuto
```

| Endereço | O que é |
|---|---|
| http://localhost:8080 | **Portal Web** (comunidade) |
| http://localhost:8080/painel/ | **Painel Admin** (login: `ADMIN_EMAIL` / `ADMIN_SENHA` do `.env`) |
| http://127.0.0.1:8081 | Painel do Traefik (rotas do gateway) |
| http://127.0.0.1:15672 | Painel do RabbitMQ |

Instruções completas (Kubernetes, atualização a partir da Parte 3, desenvolvimento): [`docs/README-COMPLETO.md`](docs/README-COMPLETO.md#-execução-e-infraestrutura).

---

## ▶️ Roteiro da demonstração

Comandos na ordem da apresentação (requer Node.js 22 no computador).

**1. Fluxo completo automático** (login, curadoria, SAGA com sucesso e com falha, CQRS, feed, favoritos, assistente, falha do LLM):

```powershell
node scripts/demonstracao.mjs
```

**2. Falha da SAGA com compensação, ao vivo:** pare o Assistente, publique uma oportunidade no [Painel Admin](http://localhost:8080/painel/) e mostre a compensação. Depois volte o serviço.

```powershell
docker compose stop assistente
docker compose start assistente
```

**3. CQRS refletindo a escrita** (modelo de leitura):

```powershell
docker compose exec oportunidades-leitura-db psql -U oportunidades_leitura -c "SELECT titulo, versao, visivel FROM oportunidades_view"
```

**4. Bancos separados:**

```powershell
docker compose exec identidade-db psql -U identidade -c "\dt"
docker compose exec coleta-db mongosh -u root -p --authenticationDatabase admin coleta --eval "db.candidatos.countDocuments()"
```

**5. LLM como dependência falível** (fallback, disjuntor, latência e custo):

```powershell
node scripts/falha-llm.mjs on       # derruba o LLM: fallback e, após 3 falhas, circuito aberto
node scripts/falha-llm.mjs status   # disjuntor, latência, tokens e custo
node scripts/falha-llm.mjs off
```

**6. Avaliação do RAG** (com e sem recuperação):

```powershell
node scripts/avaliar-rag.mjs        # gera docs/parte-4/avaliacao-rag.md
```
