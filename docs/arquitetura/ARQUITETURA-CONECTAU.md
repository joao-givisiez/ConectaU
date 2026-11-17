# Arquitetura do ConectaU
## Documento consolidado â€” Parte 2 (itens 4.1 a 4.7)

> **Status geral:** proposta arquitetural. Os serviÃ§os e fluxos descritos neste documento representam o projeto definido para a Parte 2 e nÃ£o significam que estejam implementados.

## Objetivo deste documento

Este arquivo reÃºne em um Ãºnico lugar a arquitetura do ConectaU, consolidando a decomposiÃ§Ã£o em microsserviÃ§os, os contratos REST, o API Gateway, os BFFs, a estratÃ©gia de dados e mensageria, a SAGA de publicaÃ§Ã£o e o CQRS. Ele serve como documento central de apresentaÃ§Ã£o e consulta da arquitetura.

A especificaÃ§Ã£o completa dos contratos e schemas da API permanece no arquivo [`openapi.yaml`](docs/arquitetura/openapi.yaml), que complementa esta visÃ£o consolidada.

## SumÃ¡rio

1. [4.1 â€” DecomposiÃ§Ã£o em microsserviÃ§os](#41-decomposicao-em-microsservicos)
2. [4.2 â€” API REST](#42-api-rest)
3. [4.3 â€” API Gateway e roteamento](#43-api-gateway-e-roteamento)
4. [4.4 â€” Backend for Frontend (BFF)](#44-backend-for-frontend-bff)
5. [4.5 â€” Dados, consistÃªncia eventual e Outbox](#45-dados-consistencia-eventual-e-outbox)
6. [4.6 â€” SAGA de publicaÃ§Ã£o](#46-saga-de-publicacao)
7. [4.7 â€” CQRS](#47-cqrs)

---

## 4.1 DecomposiÃ§Ã£o em microsserviÃ§os

> **Status:** Proposta arquitetural.

## DecisÃµes de produto que guiam a decomposiÃ§Ã£o

A decomposiÃ§Ã£o parte de cinco decisÃµes de produto. Elas explicam por que nÃ£o existem serviÃ§os de *InscriÃ§Ãµes* e *Vagas*:

| DecisÃ£o | ConsequÃªncia arquitetural |
|---|---|
| O ConectaU Ã© uma **camada de descoberta**: a inscriÃ§Ã£o acontece no canal oficial (link `fonteOficial`) | NÃ£o hÃ¡ serviÃ§o de inscriÃ§Ãµes nem de vagas. A transaÃ§Ã£o distribuÃ­da do sistema passa a ser o fluxo de **publicaÃ§Ã£o** de uma oportunidade |
| Oportunidades entram por **coleta automÃ¡tica** de eventos da UFLA (palestras, workshops, minicursos) **e** por cadastro manual | ServiÃ§o prÃ³prio de **Coleta**, com fontes, execuÃ§Ãµes, deduplicaÃ§Ã£o e fila de curadoria |
| **NÃ£o existe usuÃ¡rio publicador.** Quem quer divulgar fala com um **admin** da plataforma, que publica | Apenas dois papÃ©is: `ESTUDANTE` e `ADMIN`. Toda publicaÃ§Ã£o passa por curadoria humana, o que evita oportunidades falsas sem um motor de verificaÃ§Ã£o |
| O cliente da comunidade Ã© **web responsivo** (funciona no celular, sem app de loja) | Dois clientes distintos â€” Portal Web e Painel Admin â€” e, portanto, dois BFFs |
| Funcionalidade de LLM: **assistente de editais** (RAG) | ServiÃ§o **Assistente** com base vetorial prÃ³pria, alimentada pela SAGA de publicaÃ§Ã£o |

## Contextos Delimitados

| # | ServiÃ§o | Responsabilidade exclusiva | Dados que possui | Banco | O que NÃƒO deve fazer |
|---|---|---|---|---|---|
| 1 | **Identidade** | Cadastro/login, perfil (curso, campus, vÃ­nculo, interesses), papÃ©is `ESTUDANTE`/`ADMIN`, emissÃ£o de JWT | `usuarios`, `interesses`, `papeis`, `outbox` | PostgreSQL | Guardar favoritos ou oportunidades |
| 2 | **Coleta** | Fontes cadastradas, execuÃ§Ã£o do coletor, normalizaÃ§Ã£o, **deduplicaÃ§Ã£o** e fila de candidatos para curadoria | `fontes`, `execucoes`, `candidatos` (bruto + campos extraÃ­dos), `outbox` | MongoDB (documentos heterogÃªneos) | Publicar por conta prÃ³pria; apenas sugere candidatos |
| 3 | **Oportunidades** | CatÃ¡logo oficial: criar, editar, publicar e encerrar; **orquestrar a SAGA de publicaÃ§Ã£o**; manter o modelo de leitura (CQRS) | Escrita: `oportunidades`, `saga_publicacao`, `outbox`. Leitura: `oportunidades_view` | PostgreSQL (escrita) + OpenSearch (leitura) | Calcular ranking ou enviar avisos |
| 4 | **Engajamento** | Favoritos ("salvar para ver depois") e **lembretes de prazo** configurados pelo usuÃ¡rio | `favoritos`, `lembretes`, `oportunidade_resumo` (cÃ³pia via evento) | PostgreSQL | Alterar a oportunidade |
| 5 | **NotificaÃ§Ãµes** | Agendar, enviar (in-app e e-mail) e registrar entregas; janelas de envio | `notificacoes`, `agendamentos`, `tentativas_entrega` | MongoDB + Redis (fila de agendamento) | Decidir sozinho quem Ã© o pÃºblico-alvo (recebe a lista pronta) |
| 6 | **RecomendaÃ§Ãµes** | ProjeÃ§Ã£o de oportunidades Ã— perfis; ranking personalizado com motivos; pÃºblico-alvo de uma oportunidade | `projecao_oportunidades`, `projecao_perfis`, `scores` | Redis (scores) + PostgreSQL (projeÃ§Ãµes) | Ser fonte oficial de oportunidades ou de perfis |
| 7 | **Assistente** | IngestÃ£o de editais na base vetorial, recuperaÃ§Ã£o, geraÃ§Ã£o de respostas, histÃ³rico de conversas | `chunks` + embeddings, `conversas`, `cache_respostas` | PostgreSQL + pgvector + Redis (cache) | Gravar em outros serviÃ§os; sÃ³ lÃª por *tools* |


> **DecisÃ£o sobre o orquestrador:** **Oportunidades** Ã© o orquestrador da SAGA de publicaÃ§Ã£o e tambÃ©m o dono do catÃ¡logo. NÃ£o existe um banco separado "do orquestrador": o estado da SAGA vive na tabela `saga_publicacao`, dentro do banco de Oportunidades.

## Justificativa das fronteiras

- **Coleta Ã— Oportunidades:** dados coletados sÃ£o *nÃ£o confiÃ¡veis* (duplicados, incompletos, de formato variÃ¡vel); o catÃ¡logo contÃ©m apenas dados *curados por um admin*. Separar impede que uma falha do coletor polua o catÃ¡logo e permite escalar os jobs pesados de coleta de forma independente.
- **Oportunidades Ã— Engajamento:** o catÃ¡logo muda pouco e Ã© lido muito; favoritos e lembretes sÃ£o dados *por usuÃ¡rio*, escritos com frequÃªncia. SÃ£o invariantes e cargas diferentes.
- **NotificaÃ§Ãµes isolado:** absorve falhas de e-mail e novas tentativas sem travar a publicaÃ§Ã£o nem os favoritos.
- **RecomendaÃ§Ãµes isolado:** o algoritmo evolui (de regras para embeddings) sem tocar no catÃ¡logo.
- **Assistente isolado:** depende de um provedor remoto caro e falÃ­vel (LLM); precisa de *circuit breaker*, cache e escala prÃ³prios.
- **Identidade isolado:** concentra dados pessoais e permissÃµes, com ciclo de vida e requisitos de proteÃ§Ã£o prÃ³prios.
- **Alternativas descartadas:** um monÃ³lito teria menor custo operacional, mas nÃ£o atenderia aos objetivos da disciplina; um serviÃ§o por entidade (ex.: "Favoritos" e "Lembretes" separados) geraria chamadas extras e transaÃ§Ãµes distribuÃ­das sem proteger nenhuma regra de negÃ³cio adicional.
- **Trade-off reconhecido:** infraestrutura mais cara, consistÃªncia eventual e maior complexidade operacional. Para uma implantaÃ§Ã£o pequena, um monÃ³lito modular poderia ser economicamente superior.

## Componentes e comunicaÃ§Ã£o

```mermaid
flowchart TB
  PW["Portal Web<br/>comunidade"]
  PA["Painel Admin<br/>administradores"]

  GW["API Gateway<br/>TLS Â· JWT Â· rate limit"]
  BW["BFF Web"]
  BA["BFF Admin"]

  PW --> GW
  PA --> GW
  GW -->|"/auth/**"| ID
  GW -->|"/web/**"| BW
  GW -->|"/admin/**"| BA
  GW -.->|"bloqueia acesso pÃºblico"| INT["/internal/**<br/>somente comunicaÃ§Ã£o interna"]

  subgraph Dominio["ServiÃ§os de domÃ­nio"]
    direction LR
    ID["Identidade"]
    CO["Coleta"]
    OP["Oportunidades<br/>CQRS + orquestrador SAGA"]
    EN["Engajamento<br/>favoritos e lembretes"]
    RE["RecomendaÃ§Ãµes"]
    NO["NotificaÃ§Ãµes"]
    AS["Assistente<br/>RAG"]
  end

  BW -->|"serviÃ§os da comunidade"| OP
  BW --> ID
  BW --> EN
  BW --> RE
  BW --> NO
  BW --> AS
  BA --> ID
  BA --> CO
  BA --> OP

  classDef cliente fill:#fff3e0,stroke:#ef6c00,color:#333
  classDef borda fill:#e3f2fd,stroke:#1565c0,color:#333
  classDef servico fill:#ffffff,stroke:#2e7d32,color:#333
  classDef interno fill:#fce4ec,stroke:#c2185b,color:#333
  class PW,PA cliente
  class GW,BW,BA borda
  class ID,CO,OP,EN,RE,NO,AS servico
  class INT interno
  style Dominio fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
```

## Contratos e ownership

- NÃ£o hÃ¡ joins SQL entre bancos de serviÃ§os; consultas cruzadas sÃ£o feitas por APIs ou por projeÃ§Ãµes alimentadas por eventos.
- Os serviÃ§os guardam referÃªncias (`usuarioId`, `oportunidadeId`, `candidatoId`), nunca chaves estrangeiras interbancos.
- Dados recebidos por eventos sÃ£o cÃ³pias derivadas e podem estar defasados (ver [4.5](#45-dados-consistencia-eventual-e-outbox)).
- **ExceÃ§Ã£o de roteamento de autenticaÃ§Ã£o:** `/auth/**` Ã© encaminhado pelo gateway diretamente ao serviÃ§o Identidade para cadastro e login; nÃ£o passa pelos BFFs. O contrato OpenAPI descreve os endpoints lÃ³gicos dos serviÃ§os (`/api/v1/**`), enquanto os clientes usam as rotas de entrada do gateway e os contratos dos BFFs.
- Endpoint interno nÃ£o Ã© endpoint pÃºblico: rotas `/internal/**` (comandos da SAGA, *tools* do assistente e chamadas internas de serviÃ§o) exigem identidade de serviÃ§o e nÃ£o sÃ£o publicadas no gateway.

## Documentos relacionados

| Item | Documento |
|---|---|
| 4.2 â€” API REST | [`4.2-api-rest.md`](#42-api-rest) Â· [`openapi.yaml`](docs/arquitetura/openapi.yaml) |
| 4.3 â€” API Gateway | [`4.3-gateway.md`](#43-api-gateway-e-roteamento) |
| 4.4 â€” BFF | [`4.4-bff.md`](#44-backend-for-frontend-bff) |
| 4.5 â€” Dados e outbox | [`4.5-dados-outbox.md`](#45-dados-consistencia-eventual-e-outbox) |
| 4.6 â€” SAGA | [`4.6-saga.md`](#46-saga-de-publicacao) |
| 4.7 â€” CQRS | [`4.7-cqrs.md`](#47-cqrs) |

---

## 4.2 API REST

> **Status:** contrato projetado, ainda nÃ£o implementado. EspecificaÃ§Ã£o formal: [`openapi.yaml`](docs/arquitetura/openapi.yaml).

> **Escopo:** este OpenAPI descreve os contratos lÃ³gicos dos serviÃ§os de domÃ­nio, nÃ£o uma API Ãºnica exposta diretamente aos navegadores. Os clientes acessam o API Gateway: `/auth/**` encaminha para Identidade, `/web/**` para o BFF Web e `/admin/**` para o BFF Admin. Os BFFs chamam os contratos de serviÃ§o internamente. Rotas `/internal/**` exigem identidade de serviÃ§o e nunca sÃ£o expostas no gateway.

## ConvenÃ§Ãµes do contrato

- **Estilo:** REST com recursos em plural, JSON (`application/json`) e HTTPS.
- **VersÃ£o:** versÃ£o principal na URL, `/api/v1`. MudanÃ§as compatÃ­veis (novos campos opcionais) permanecem na v1; alteraÃ§Ãµes incompatÃ­veis exigem `/api/v2`. Isso permite migraÃ§Ã£o gradual dos clientes.
- **Identificadores:** UUID em formato de string; datas/horas em ISO 8601 com fuso (`date-time`).
- **PapÃ©is:** apenas dois â€” `ESTUDANTE` (comunidade) e `ADMIN`. **NÃ£o existe papel de publicador:** quem quer divulgar uma oportunidade fala com um admin, que a cadastra e publica. Toda escrita no catÃ¡logo Ã© exclusiva de `ADMIN`.
- **AutenticaÃ§Ã£o:** token Bearer (JWT) para dados pessoais e operaÃ§Ãµes de escrita. A consulta e a leitura de oportunidades publicadas sÃ£o pÃºblicas.
- **AutorizaÃ§Ã£o pela identidade do token:** recursos pessoais (favoritos, lembretes, recomendaÃ§Ãµes, notificaÃ§Ãµes, conversas) **nÃ£o aceitam `usuarioId` em query**. O servidor usa sempre o `sub` do token, o que elimina a classe de falha IDOR (consultar dados de outro usuÃ¡rio trocando o id na URL).
- **Rotas internas:** `/internal/**` (comandos da SAGA, *tools* do assistente) exigem identidade de serviÃ§o e **nÃ£o sÃ£o expostas no gateway** ([4.3](#43-api-gateway-e-roteamento)).
- **Resposta de erro:** `{ "codigo": "RECURSO_NAO_ENCONTRADO", "mensagem": "Oportunidade nÃ£o encontrada" }`.
- **PaginaÃ§Ã£o:** nas listagens hÃ¡ `pagina` (a partir de 1) e `limite` (1â€“100); retorno com `itens`, `pagina`, `limite` e `total`.
- **Status HTTP:** `200` leitura/atualizaÃ§Ã£o, `201` criaÃ§Ã£o com cabeÃ§alho `Location`, `202` aceito para processamento assÃ­ncrono (publicaÃ§Ã£o via SAGA), `204` remoÃ§Ã£o sem corpo, `400` requisiÃ§Ã£o invÃ¡lida, `401` sem autenticaÃ§Ã£o, `403` sem permissÃ£o, `404` nÃ£o encontrado, `409` conflito (ex.: favorito duplicado), `422` regra de negÃ³cio (ex.: prazo anterior Ã  data de inÃ­cio).

## Contratos por serviÃ§o

| ServiÃ§o | MÃ©todo | Endpoint | FunÃ§Ã£o | Acesso | Sucesso |
|---|---|---|---|---|---|
| Identidade | POST | `/api/v1/usuarios` | Criar perfil | PÃºblico | 201 |
| Identidade | POST | `/api/v1/sessoes` | Autenticar e obter JWT | PÃºblico | 201 |
| Identidade | GET | `/api/v1/usuarios/{usuarioId}` | Consultar perfil | Dono | 200 |
| Identidade | PATCH | `/api/v1/usuarios/{usuarioId}` | Alterar curso, campus e interesses | Dono | 200 |
| Oportunidades | GET | `/api/v1/oportunidades` | Listar e filtrar (modelo de leitura) | PÃºblico | 200 |
| Oportunidades | GET | `/api/v1/oportunidades/{oportunidadeId}` | Consultar detalhes | PÃºblico | 200 |
| Oportunidades | POST | `/api/v1/oportunidades` | Cadastrar oportunidade | **ADMIN** | 201 |
| Oportunidades | PATCH | `/api/v1/oportunidades/{oportunidadeId}` | Atualizar dados da oportunidade (sem alterar status) | **ADMIN** | 200 |
| Oportunidades | POST | `/api/v1/oportunidades/{oportunidadeId}/encerramento` | Encerrar oportunidade publicada | **ADMIN** | 200 |
| Oportunidades | DELETE | `/api/v1/oportunidades/{oportunidadeId}` | Excluir cadastro ainda em `RASCUNHO` (nÃ£o substitui encerramento) | **ADMIN** | 204 |
| Oportunidades | POST | `/api/v1/oportunidades/{oportunidadeId}/publicacao` | Disparar a SAGA de publicaÃ§Ã£o | **ADMIN** | 202 |
| Oportunidades | GET | `/api/v1/publicacoes/{sagaId}` | Acompanhar o estado da SAGA | **ADMIN** | 200 |
| Coleta | GET | `/api/v1/fontes` | Listar fontes de coleta | **ADMIN** | 200 |
| Coleta | POST | `/api/v1/fontes` | Cadastrar fonte | **ADMIN** | 201 |
| Coleta | GET | `/api/v1/execucoes` | HistÃ³rico de execuÃ§Ãµes do coletor | **ADMIN** | 200 |
| Coleta | GET | `/api/v1/candidatos` | Fila de curadoria (`?status=PENDENTE`) | **ADMIN** | 200 |
| Coleta | PATCH | `/api/v1/candidatos/{candidatoId}` | Descartar ou marcar como duplicado | **ADMIN** | 200 |
| Engajamento | GET | `/api/v1/favoritos` | Listar oportunidades salvas | Dono (token) | 200 |
| Engajamento | POST | `/api/v1/favoritos` | Salvar oportunidade | Dono (token) | 201 |
| Engajamento | DELETE | `/api/v1/favoritos/{favoritoId}` | Remover dos favoritos | Dono | 204 |
| Engajamento | GET | `/api/v1/lembretes` | Listar lembretes de prazo | Dono (token) | 200 |
| Engajamento | POST | `/api/v1/lembretes` | Criar lembrete de prazo | Dono (token) | 201 |
| Engajamento | DELETE | `/api/v1/lembretes/{lembreteId}` | Remover lembrete | Dono | 204 |
| RecomendaÃ§Ãµes | GET | `/api/v1/recomendacoes` | Oportunidades ordenadas para o usuÃ¡rio do token | Dono (token) | 200 |
| NotificaÃ§Ãµes | GET | `/api/v1/notificacoes` | Listar avisos | Dono (token) | 200 |
| NotificaÃ§Ãµes | GET | `/api/v1/notificacoes/{notificacaoId}` | Consultar aviso | Dono | 200 |
| NotificaÃ§Ãµes | PATCH | `/api/v1/notificacoes/{notificacaoId}` | Marcar aviso como lido | Dono | 200 |
| Assistente | POST | `/api/v1/conversas` | Abrir conversa sobre editais | Autenticado | 201 |
| Assistente | POST | `/api/v1/conversas/{conversaId}/mensagens` | Enviar pergunta e obter resposta com citaÃ§Ãµes | Dono | 201 |

**RestriÃ§Ãµes principais:** `GET /oportunidades` aceita `busca`, `campus`, `categoria`, `pagina`, `limite` e retorna apenas oportunidades em `PUBLICADA`. NÃ£o aceita filtro pÃºblico de status, evitando exposiÃ§Ã£o de `RASCUNHO` ou `PUBLICANDO`. O detalhe pÃºblico tambÃ©m responde apenas para oportunidades `PUBLICADA`; rascunhos e publicaÃ§Ãµes em andamento sÃ£o inacessÃ­veis pelas consultas pÃºblicas. `GET /candidatos` aceita `status`, `fonteId`, `pagina`, `limite`; `GET /notificacoes` aceita `lida`, `pagina`, `limite`. Nenhuma listagem pessoal aceita `usuarioId`. Os corpos e tipos constam integralmente no YAML OpenAPI.

## Exemplos de requisiÃ§Ã£o e resposta

**Cadastro de oportunidade â€” `POST /api/v1/oportunidades`** (token com `role=ADMIN`):

```json
{
  "titulo": "Workshop de Docker",
  "descricao": "Workshop prÃ¡tico de containers para a comunidade acadÃªmica.",
  "categoria": "EVENTO",
  "campus": "LAVRAS",
  "dataInicio": "2026-11-12T14:00:00-03:00",
  "prazoInscricao": "2026-11-10T23:59:00-03:00",
  "fonteUrl": "https://www.ufla.br/",
  "tags": ["tecnologia", "containers"],
  "candidatoId": "0f1d8f2c-2b8e-4f1a-9f3a-9a1b2c3d4e5f"
}
```

A oportunidade nasce em `RASCUNHO`: **o status nÃ£o Ã© definido pelo cliente**. A transiÃ§Ã£o para `PUBLICADA` acontece apenas pela SAGA. Consultas pÃºblicas retornam somente oportunidades `PUBLICADA`; o contrato administrativo pode consultar os estados internos.

**Resposta `201 Created`** â€” `Location: /api/v1/oportunidades/550e8400-e29b-41d4-a716-446655440002`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "titulo": "Workshop de Docker",
  "categoria": "EVENTO",
  "campus": "LAVRAS",
  "prazoInscricao": "2026-11-10T23:59:00-03:00",
  "fonteUrl": "https://www.ufla.br/",
  "status": "RASCUNHO",
  "_links": {
    "self": { "href": "/api/v1/oportunidades/550e8400-e29b-41d4-a716-446655440002", "method": "GET" },
    "colecao": { "href": "/api/v1/oportunidades", "method": "GET" },
    "publicar": { "href": "/api/v1/oportunidades/550e8400-e29b-41d4-a716-446655440002/publicacao", "method": "POST" },
    "fonteOficial": { "href": "https://www.ufla.br/", "method": "GET" }
  }
}
```

**PublicaÃ§Ã£o â€” `POST /api/v1/oportunidades/{id}/publicacao`** responde `202 Accepted`, porque o trabalho Ã© assÃ­ncrono e distribuÃ­do ([4.6](#46-saga-de-publicacao)):

```json
{
  "sagaId": "9a7c1b44-6c2e-4a9b-9a1e-7f0c2d3e4a55",
  "estado": "INICIADA",
  "_links": { "estado": { "href": "/api/v1/publicacoes/9a7c1b44-6c2e-4a9b-9a1e-7f0c2d3e4a55", "method": "GET" } }
}
```

**RecomendaÃ§Ãµes â€” `GET /api/v1/recomendacoes`** (sem `usuarioId`; a identidade vem do token):

```json
{
  "itens": [
    {
      "oportunidadeId": "550e8400-e29b-41d4-a716-446655440002",
      "pontuacao": 0.92,
      "motivos": ["Interesse em tecnologia", "Campus compatÃ­vel"]
    }
  ],
  "pagina": 1,
  "limite": 20,
  "total": 1
}
```

O endereÃ§o de fonte usado nos exemplos Ã© **apenas ilustrativo**, nÃ£o representa um edital real.

## HATEOAS: navegaÃ§Ã£o a partir do recurso Oportunidade

HATEOAS (*Hypermedia as the Engine of Application State*) significa que a resposta traz **links para as aÃ§Ãµes possÃ­veis naquele estado e para aquele papel**. Os links dependem do estado da oportunidade e do papel de quem consulta:

| RelaÃ§Ã£o | NavegaÃ§Ã£o ou aÃ§Ã£o | CondiÃ§Ã£o |
|---|---|---|
| `self` | Consultar novamente a mesma oportunidade | Sempre |
| `colecao` | Voltar Ã  listagem | Sempre |
| `salvar` | Criar favorito apontando para essa oportunidade | Autenticado e prazo em aberto |
| `lembrar` | Criar lembrete de prazo | Autenticado e prazo em aberto |
| `perguntar` | Abrir conversa com o assistente sobre o edital | Autenticado e oportunidade indexada |
| `fonteOficial` | **Abrir o canal oficial, onde a inscriÃ§Ã£o acontece** | Sempre |
| `publicar` | Disparar a SAGA de publicaÃ§Ã£o | `ADMIN` **e** status `RASCUNHO` |
| `encerrar` | Encerrar oportunidade publicada | `ADMIN` **e** status `PUBLICADA` |

```json
"_links": {
  "self":         { "href": "/web/oportunidades/{id}", "method": "GET" },
  "colecao":      { "href": "/web/oportunidades", "method": "GET" },
  "salvar":       { "href": "/web/favoritos", "method": "POST" },
  "lembrar":      { "href": "/web/lembretes", "method": "POST" },
  "perguntar":    { "href": "/web/conversas", "method": "POST" },
  "fonteOficial": { "href": "https://www.ufla.br/", "method": "GET" }
}
```

`salvar` e `lembrar` desaparecem quando o prazo jÃ¡ passou; `publicar` sÃ³ aparece para `ADMIN` com a oportunidade em `RASCUNHO`, e `encerrar` sÃ³ aparece para `ADMIN` quando a oportunidade estÃ¡ em `PUBLICADA`. A API pÃºblica nunca retorna rascunhos ou oportunidades em `PUBLICANDO`; para operaÃ§Ãµes administrativas, o BFF Admin usa o contrato autenticado do serviÃ§o Oportunidades. Os links sÃ£o metadados de navegaÃ§Ã£o â€” nÃ£o executam aÃ§Ãµes automaticamente. Note que **nÃ£o existe link de "inscrever-se"**: o ConectaU Ã© camada de descoberta, e a inscriÃ§Ã£o ocorre fora da plataforma, pelo `fonteOficial`.

## Regras de validaÃ§Ã£o e erros esperados

- Criar oportunidade sem `titulo`, `categoria`, `campus`, `prazoInscricao` ou `fonteUrl`: **400**.
- Prazo anterior Ã  data de inÃ­cio ou outra regra violada: **422**.
- Consultar uma oportunidade inexistente: **404**.
- Cadastrar ou publicar oportunidade sem token: **401**; autenticado como `ESTUDANTE`: **403**.
- Acessar qualquer rota de Coleta sem papel `ADMIN`: **403**.
- Publicar uma oportunidade que nÃ£o estÃ¡ em `RASCUNHO`: **409**.
- Encerrar uma oportunidade que nÃ£o estÃ¡ em `PUBLICADA`: **409**.
- Consultar uma oportunidade nÃ£o publicada pela API pÃºblica: **404**.
- Salvar duas vezes o mesmo par usuÃ¡rio/oportunidade: **409**.
- Criar lembrete para oportunidade jÃ¡ encerrada: **422**.

O arquivo [`openapi.yaml`](docs/arquitetura/openapi.yaml) define os **schemas**, parÃ¢metros de path/query, corpos e respostas de cada endpoint e pode ser importado no [Swagger Editor](https://editor.swagger.io/). Nenhum endpoint aqui Ã© afirmado como jÃ¡ disponÃ­vel em produÃ§Ã£o.

---

## 4.3 API Gateway e roteamento

> **Status:** proposta arquitetural da Parte 2. NÃ£o implementado.

O API Gateway Ã© o **Ãºnico ponto de entrada** do ConectaU. Clientes nunca chamam um serviÃ§o de domÃ­nio diretamente: falam com o gateway, que encaminha a requisiÃ§Ã£o ao BFF correspondente.

## Tecnologia proposta

**Kong** ou **Traefik**. Ambos funcionam como Ingress Controller no Kubernetes, o que evita manter duas camadas distintas de entrada quando a Parte 3 for implantada.

## Regras de roteamento

| Caminho | Destino | AutorizaÃ§Ã£o |
|---|---|---|
| `/auth/**` | Identidade (cadastro e login) | PÃºblico |
| `/web/**` | BFF Web | JWT vÃ¡lido, exceto nas rotas pÃºblicas de consulta |
| `/admin/**` | BFF Admin | JWT vÃ¡lido **com `role=ADMIN`** |
| `/internal/**` | â€” | **Bloqueado no gateway** |

A rota `/auth/**` Ã© uma exceÃ§Ã£o deliberada: encaminha cadastro e login diretamente Ã  Identidade, pois essas operaÃ§Ãµes precisam funcionar antes de existir JWT. As rotas `/internal/**` sÃ£o usadas pelos comandos da SAGA, pelas *tools* do assistente e por chamadas internas entre serviÃ§os. Elas existem apenas dentro da rede privada, autenticadas por identidade de serviÃ§o, e nunca sÃ£o publicadas.

O [`openapi.yaml`](docs/arquitetura/openapi.yaml) descreve os contratos lÃ³gicos dos serviÃ§os em `/api/v1/**`; ele nÃ£o significa que o navegador possa chamar os microsserviÃ§os diretamente. O cliente chama `/auth/**`, `/web/**` ou `/admin/**`, e os BFFs encaminham chamadas internas aos serviÃ§os correspondentes.

## Responsabilidades

| Responsabilidade | Como Ã© aplicada |
|---|---|
| **TerminaÃ§Ã£o TLS** | Certificado no gateway; trÃ¡fego interno do cluster segue em rede privada |
| **ValidaÃ§Ã£o de JWT** | O gateway verifica assinatura e expiraÃ§Ã£o usando a chave pÃºblica da Identidade e rejeita o que for invÃ¡lido antes de chegar ao BFF |
| **AutorizaÃ§Ã£o de rota** | `role=ADMIN` exigido em todo `/admin/**`; o serviÃ§o de destino revalida o papel (defesa em profundidade) |
| **Rate limiting** | Limite geral por token e por IP; limite **mais restrito** em `/web/assistente/**`, porque cada requisiÃ§Ã£o consome crÃ©dito de LLM |
| **CORS** | Origens permitidas: domÃ­nios do Portal Web e do Painel Admin |
| **CorrelaÃ§Ã£o** | Gera `X-Request-Id` quando ausente e propaga em todas as chamadas internas, permitindo rastrear uma publicaÃ§Ã£o ponta a ponta |
| **Logs de acesso** | MÃ©todo, rota, status, latÃªncia e `X-Request-Id`; sem corpo de requisiÃ§Ã£o, para nÃ£o registrar dados pessoais |

## O que o gateway NÃƒO faz

- NÃ£o agrega respostas de vÃ¡rios serviÃ§os â€” isso Ã© papel do BFF ([4.4](#44-backend-for-frontend-bff)).
- NÃ£o aplica regra de negÃ³cio nem transforma payload de domÃ­nio.
- NÃ£o guarda estado de sessÃ£o: a autenticaÃ§Ã£o Ã© via JWT, o que mantÃ©m o gateway escalÃ¡vel horizontalmente.

## Fluxo de uma requisiÃ§Ã£o

```mermaid
sequenceDiagram
  actor U as UsuÃ¡rio
  participant GW as API Gateway
  participant BW as BFF Web
  participant OP as Oportunidades
  participant EN as Engajamento
  U->>GW: GET /web/feed (Bearer JWT)
  GW->>GW: TLS Â· valida JWT Â· rate limit Â· X-Request-Id
  GW->>BW: GET /feed (+ identidade do token)
  BW->>OP: consulta modelo de leitura
  BW->>EN: favoritos do usuÃ¡rio
  BW-->>GW: feed agregado
  GW-->>U: 200 OK
```

Se o JWT for invÃ¡lido o gateway responde `401` sem acionar nenhum serviÃ§o; se o papel nÃ£o for `ADMIN` em `/admin/**`, responde `403`.

---

## 4.4 Backend for Frontend (BFF)

> **Status:** proposta arquitetural da Parte 2. NÃ£o implementado.

O ConectaU tem **dois clientes com necessidades opostas**: o Portal Web da comunidade (uso em celular, descoberta rÃ¡pida, payload pequeno) e o Painel Admin (curadoria, tabelas grandes, dados brutos de coleta). Servir os dois com a mesma API levaria a respostas grandes demais para um e incompletas para o outro. Por isso hÃ¡ **um BFF por cliente**.

## ComparaÃ§Ã£o

| | **BFF Web** (comunidade, mobile-first) | **BFF Admin** (administradores) |
|---|---|---|
| Foco | Descoberta rÃ¡pida em tela pequena | Curadoria e operaÃ§Ã£o |
| Agrega | Oportunidades (leitura) + Engajamento (estado "salvo") + RecomendaÃ§Ãµes + NotificaÃ§Ãµes nÃ£o lidas + Assistente | Coleta (candidatos) + Oportunidades (escrita) + estado da SAGA + mÃ©tricas |
| Resposta | Cards compactos: tÃ­tulo, data, campus, categoria, `salvo`, `motivo` da recomendaÃ§Ã£o, `prazoEmDias` | Registro completo: fonte de origem, conteÃºdo extraÃ­do, score de duplicidade, histÃ³rico de status, passos da SAGA |
| Payload | Pequeno; paginaÃ§Ã£o curta (10 itens); imagens reduzidas | Tabelas grandes, filtros avanÃ§ados, exportaÃ§Ã£o |
| AutorizaÃ§Ã£o | JWT de `ESTUDANTE` ou `ADMIN` | Somente `ADMIN` |

## Por que BFF e nÃ£o uma API Ãºnica

- **NÃºmero de chamadas.** O feed precisa de 3 serviÃ§os (catÃ¡logo, favoritos, recomendaÃ§Ãµes). Sem BFF, o celular faria 3 requisiÃ§Ãµes e juntaria os dados no cliente â€” mais latÃªncia em rede mÃ³vel.
- **Formato.** O mesmo recurso `Oportunidade` tem representaÃ§Ãµes diferentes: o estudante vÃª um card, o admin vÃª a procedÃªncia e a auditoria.
- **EvoluÃ§Ã£o.** O Painel Admin pode mudar sem forÃ§ar mudanÃ§a no contrato consumido pelo Portal Web.

O custo aceito Ã© manter dois componentes em vez de um. Ele Ã© mitigado porque ambos os BFFs sÃ£o finos: nÃ£o tÃªm banco prÃ³prio e nÃ£o sÃ£o donos das regras de negÃ³cio. Eles agregam respostas, adaptam formatos para cada cliente e aplicam regras de composiÃ§Ã£o da resposta; as validaÃ§Ãµes de domÃ­nio permanecem nos serviÃ§os responsÃ¡veis. O BFF nÃ£o substitui o RabbitMQ nem a comunicaÃ§Ã£o assÃ­ncrona da SAGA.

## Exemplos

```jsonc
// GET /web/feed  (BFF Web)
{
  "itens": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "titulo": "Workshop de Docker",
      "quando": "2026-11-12",
      "campus": "LAVRAS",
      "categoria": "EVENTO",
      "salvo": false,
      "motivo": "Interesse em tecnologia",
      "prazoEmDias": 3
    }
  ],
  "pagina": 1,
  "limite": 10,
  "total": 1
}
```

```jsonc
// GET /admin/oportunidades/{id}  (BFF Admin)
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "titulo": "Workshop de Docker",
  "status": "PUBLICADA",
  "origem": {
    "tipo": "COLETA",
    "fonte": "Agenda DCC",
    "candidatoId": "0f1dâ€¦",
    "coletadoEm": "2026-10-30T08:12:00-03:00",
    "scoreDuplicidade": 0.12
  },
  "saga": {
    "id": "9a7câ€¦",
    "estado": "CONCLUIDA",
    "passos": [
      { "passo": "CONSUMIR_CANDIDATO", "estado": "OK" },
      { "passo": "INDEXAR_ASSISTENTE", "estado": "OK", "chunks": 14 },
      { "passo": "AGENDAR_AVISOS", "estado": "OK", "destinatarios": 128 }
    ]
  },
  "metricas": { "visualizacoes": 312, "favoritos": 41 }
}
```

## Regras comuns aos dois BFFs

- A identidade vem **sempre do JWT**, nunca de um parÃ¢metro `usuarioId` enviado pelo cliente (ver [4.2](#42-api-rest)).
- Nenhum BFF tem banco de dados; um cache curto em memÃ³ria (segundos) Ã© aceitÃ¡vel para o feed.
- Falha de um serviÃ§o secundÃ¡rio degrada o BFF em vez de derrubÃ¡-lo: se RecomendaÃ§Ãµes nÃ£o responde, o feed sai sem o campo `motivo`; se o Assistente estÃ¡ indisponÃ­vel, o card da oportunidade continua visÃ­vel; apenas a aÃ§Ã£o de perguntar ao assistente fica indisponÃ­vel.

---

## 4.5 Dados, consistÃªncia eventual e Outbox

> **Status:** proposta arquitetural da Parte 2. NÃ£o implementado.

## 1. Database per service

Cada serviÃ§o tem **instÃ¢ncia prÃ³pria** de banco (um container, ou um StatefulSet com PVC na Parte 3). Nenhum serviÃ§o lÃª o banco de outro, e nÃ£o existe join entre bancos: toda cÃ³pia local de dado alheio chega por evento.

| ServiÃ§o | Banco | Por quÃª |
|---|---|---|
| Identidade | PostgreSQL | Dados relacionais com integridade forte |
| Coleta | MongoDB | Documentos heterogÃªneos: cada fonte devolve um formato diferente |
| Oportunidades | PostgreSQL (escrita) + OpenSearch (leitura) | Regras de negÃ³cio na escrita, busca textual na leitura ([4.7](#47-cqrs)) |
| Engajamento | PostgreSQL | RelaÃ§Ãµes usuÃ¡rio Ã— oportunidade, escrita frequente |
| NotificaÃ§Ãµes | MongoDB + Redis | HistÃ³rico flexÃ­vel + fila de agendamento |
| RecomendaÃ§Ãµes | PostgreSQL + Redis | ProjeÃ§Ãµes persistidas + scores volÃ¡teis |
| Assistente | PostgreSQL + pgvector + Redis | Chunks e embeddings no mesmo banco + cache de respostas |

## 2. Pontos de consistÃªncia eventual

| Dado copiado | Origem â†’ destino | Defasagem aceitÃ¡vel |
|---|---|---|
| Oportunidade publicada/editada/encerrada | Oportunidades â†’ RecomendaÃ§Ãµes e Engajamento (`oportunidade_resumo`) | segundos |
| Perfil e interesses | Identidade â†’ RecomendaÃ§Ãµes | segundos |
| Modelo de leitura (CQRS) | Escrita â†’ OpenSearch | â‰¤ 5 s |
| Prazo alterado | Oportunidades â†’ Engajamento (reagenda lembretes) | â‰¤ 1 min |

ConsequÃªncia assumida: por alguns segundos, o feed pode exibir uma versÃ£o anterior de uma oportunidade recÃ©m-editada. Ã‰ aceitÃ¡vel porque o ConectaU Ã© uma camada de descoberta â€” o dado definitivo estÃ¡ sempre no link `fonteOficial`.

## 3. Risco de dual write

*Dual write* Ã© gravar no banco **e** publicar um evento como duas operaÃ§Ãµes separadas: se a segunda falhar, os dois lados ficam divergentes e ninguÃ©m percebe.

| Onde ocorre | Risco | Tratamento |
|---|---|---|
| Oportunidades grava no Postgres **e** publica `OportunidadePublicada` | Gravar sem publicar (ninguÃ©m Ã© avisado) ou publicar e dar rollback (evento fantasma) | **Outbox** |
| Coleta salva candidato **e** publica `CandidatoColetado` para avisar os administradores | Aviso perdido ou candidato nÃ£o sinalizado para curadoria | **Outbox**; o BFF Admin consulta a fila pela API de Coleta |
| Identidade altera interesses **e** avisa RecomendaÃ§Ãµes | RecomendaÃ§Ã£o desatualizada | **Outbox** |
| Assistente grava chunks **e** confirma Ã  SAGA | ConfirmaÃ§Ã£o sem Ã­ndice correspondente | Resposta sÃ­ncrona idempotente por `sagaId` |

## Diagrama â€” mensageria e integraÃ§Ãµes externas

Este diagrama mostra os principais produtores e consumidores de eventos. O fluxo de outbox continua detalhado logo abaixo.

```mermaid
flowchart LR
  subgraph Prod["Produtores â€” banco + outbox"]
    OP["Oportunidades"]
    CO["Coleta"]
    ID["Identidade"]
  end

  RELAY["Relays da outbox"]
  MQ[("RabbitMQ")]

  OP --> RELAY
  CO --> RELAY
  ID --> RELAY
  RELAY --> MQ

  subgraph Cons["Consumidores de eventos"]
    RE["RecomendaÃ§Ãµes"]
    EN["Engajamento"]
    NO["NotificaÃ§Ãµes"]
    PR["Projetor CQRS"]
  end

  MQ --> RE
  MQ --> EN
  MQ --> NO
  MQ --> PR
  PR --> OS[("OpenSearch<br/>Ã­ndice pÃºblico de oportunidades")]

  SCR["Sites e portais pÃºblicos da UFLA"] -. "coleta" .-> CO
  AS["Assistente (RAG)"] -. "consulta ao LLM / embeddings" .-> LLM["Provedor externo de LLM e embeddings"]
  AS -->|"tool: buscar oportunidades"| OP
  AS -->|"tool: consultar perfil"| ID

  classDef servico fill:#ffffff,stroke:#2e7d32,color:#333
  classDef externo fill:#fce4ec,stroke:#c2185b,color:#333
  classDef infraestrutura fill:#fff8e1,stroke:#f9a825,color:#333
  class OP,CO,ID,RE,EN,NO,PR,AS servico
  class SCR,LLM externo
  class MQ,RELAY,OS infraestrutura
  style Prod fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
  style Cons fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20
```

### Como explicar o diagrama

- Cada produtor grava o evento na prÃ³pria outbox junto com a alteraÃ§Ã£o de negÃ³cio; um relay publica depois no RabbitMQ.
- Os consumidores recebem apenas os eventos de que precisam e devem ser idempotentes, porque uma mensagem pode ser entregue mais de uma vez.
- O Projetor CQRS atualiza o Ã­ndice OpenSearch usado pela busca. O Ã­ndice pÃºblico deve conter somente oportunidades `PUBLICADA`.
- A Coleta obtÃ©m candidatos de fontes pÃºblicas, mas eles sÃ³ entram no catÃ¡logo apÃ³s curadoria administrativa. O evento `CandidatoColetado` pode disparar um aviso aos ADMINs; a fila de curadoria em si Ã© consultada pelo BFF Admin na API de Coleta.
- O Assistente RAG Ã© diferente do Projetor CQRS: ele prepara conteÃºdo para responder perguntas sobre editais, enquanto o projetor mantÃ©m o Ã­ndice de busca das oportunidades.

## 4. Transactional Outbox

O evento Ã© gravado **na mesma transaÃ§Ã£o** do dado de negÃ³cio, numa tabela `outbox` do prÃ³prio serviÃ§o. Um processo *relay* lÃª essa tabela e publica no RabbitMQ. Como gravaÃ§Ã£o e registro do evento sÃ£o atÃ´micos, nÃ£o existe estado em que um aconteceu e o outro nÃ£o.

### Detalhe tÃ©cnico â€” ciclo de uma mensagem da outbox

```mermaid
sequenceDiagram
  participant OP as Oportunidades
  participant DB as PostgreSQL (OP)
  participant R as Relay (poller)
  participant MQ as RabbitMQ
  participant RE as RecomendaÃ§Ãµes
  OP->>DB: BEGIN; UPDATE oportunidades SET status='PUBLICADA';<br/>INSERT outbox(evento=OportunidadePublicada); COMMIT
  loop a cada 1s
    R->>DB: SELECT * FROM outbox WHERE enviado_em IS NULL FOR UPDATE SKIP LOCKED
    R->>MQ: publish (messageId = outbox.id)
    R->>DB: UPDATE outbox SET enviado_em = now()
  end
  MQ->>RE: OportunidadePublicada
  RE->>RE: ignora se messageId jÃ¡ processado
```

### PreparaÃ§Ã£o e ativaÃ§Ã£o de avisos na SAGA

Durante a SAGA, Oportunidades solicita a RecomendaÃ§Ãµes o pÃºblico-alvo e chama NotificaÃ§Ãµes para **preparar agendamentos pendentes** identificados por `sagaId`. Esses agendamentos ainda nÃ£o enviam avisos. Quando `OportunidadePublicada` chega pela Outbox, NotificaÃ§Ãµes ativa os agendamentos preparados; se nÃ£o houver preparaÃ§Ã£o (por exemplo, durante recuperaÃ§Ã£o ou reprocessamento), cria-os de forma idempotente usando a chave de negÃ³cio `oportunidadeId + tipoAviso + destinatarioId`. Assim, a etapa da SAGA nÃ£o duplica os avisos que o consumidor do evento ativa.

### Entrega e idempotÃªncia

A entrega Ã© **at-least-once**: se o relay publicar e falhar antes de marcar `enviado_em`, o mesmo evento serÃ¡ publicado de novo. Por isso todo consumidor Ã© **idempotente** â€” registra o `messageId` numa tabela `mensagens_processadas` e descarta o que jÃ¡ viu.

### Eventos previstos

| Evento | Publicado por | Consumido por |
|---|---|---|
| `UsuarioCriado`, `InteressesAlterados` | Identidade | RecomendaÃ§Ãµes |
| `CandidatoColetado` | Coleta | NotificaÃ§Ãµes (aviso aos ADMINs); o BFF Admin consulta os candidatos pela API de Coleta |
| `OportunidadeCriada` | Oportunidades | projetor CQRS (mantÃ©m fora do Ã­ndice pÃºblico atÃ© a publicaÃ§Ã£o) |
| `OportunidadePublicada` | Oportunidades | RecomendaÃ§Ãµes, Engajamento, NotificaÃ§Ãµes, projetor do CQRS |
| `OportunidadeEditada`, `OportunidadeEncerrada` | Oportunidades | Engajamento (reagendar/remover lembretes), RecomendaÃ§Ãµes e projetor do CQRS |
| `LembreteVencendo` | Engajamento | NotificaÃ§Ãµes |

## 5. Falhas e recuperaÃ§Ã£o

- **Mensagem envenenada:** apÃ³s N tentativas, vai para uma *dead letter queue* e gera alerta; nÃ£o bloqueia a fila.
- **RabbitMQ indisponÃ­vel:** os eventos ficam acumulados na `outbox` e sÃ£o publicados quando o broker volta, desde que a persistÃªncia e o relay sejam recuperados. O monitoramento alerta sobre acÃºmulo prolongado.
- **Consumidor fora do ar:** a fila retÃ©m as mensagens; ao voltar, ele processa o atraso.

---

## 4.6 SAGA de publicaÃ§Ã£o

> **Status:** proposta arquitetural da Parte 2. NÃ£o implementado.

## 1. Qual Ã© a transaÃ§Ã£o distribuÃ­da

Como o ConectaU **nÃ£o faz inscriÃ§Ã£o** â€” o usuÃ¡rio se inscreve no canal oficial, pelo link `fonteOficial` â€”, a transaÃ§Ã£o de negÃ³cio que atravessa serviÃ§os nÃ£o Ã© a candidatura, e sim **tornar uma oportunidade pÃºblica**.

Uma oportunidade sÃ³ deve aparecer como publicada se, ao mesmo tempo:

1. o candidato que a originou foi consumido na Coleta (trava contra publicaÃ§Ã£o duplicada);
2. o Assistente conseguiu indexÃ¡-la (senÃ£o o estudante pergunta e nÃ£o hÃ¡ resposta);
3. os avisos ao pÃºblico-alvo foram agendados.

A SAGA coordena os participantes para que uma falha nÃ£o deixe um resultado parcial permanente. Durante o processamento, estados intermediÃ¡rios como `PUBLICANDO` podem existir; em caso de falha, hÃ¡ novas tentativas e compensaÃ§Ãµes. Participam **5 serviÃ§os**: Oportunidades (orquestrador), Coleta (quando hÃ¡ candidato), Assistente, RecomendaÃ§Ãµes (calcula o pÃºblico-alvo) e NotificaÃ§Ãµes (prepara os avisos).

## 2. Variante escolhida: SAGA orquestrada

O orquestrador vive **dentro do serviÃ§o Oportunidades**, com o estado na tabela `saga_publicacao`.

| Por que orquestrada | Por que nÃ£o coreografada |
|---|---|
| Fluxo linear, com ordem de compensaÃ§Ã£o explÃ­cita | Com vÃ¡rios participantes, a lÃ³gica ficaria espalhada em handlers de eventos, difÃ­cil de rastrear |
| O admin precisa ver o **estado da publicaÃ§Ã£o** no painel | NÃ£o haveria um lugar Ãºnico com o estado da transaÃ§Ã£o |
| Facilita provocar e demonstrar a falha | Risco de ciclos de eventos |

**Custo aceito:** o orquestrador fica acoplado aos contratos dos participantes. Ã‰ mitigado porque os comandos sÃ£o poucos, versionados e expostos apenas em `/internal/**`.

## 3. Passos e compensaÃ§Ãµes

| # | ServiÃ§o | AÃ§Ã£o | CompensaÃ§Ã£o |
|---|---|---|---|
| 1 | Oportunidades | Inicia a publicaÃ§Ã£o de uma oportunidade em `RASCUNHO`, mudando-a para `PUBLICANDO` | Volta para `RASCUNHO` e registra `FALHA_PUBLICACAO` |
| 2 | Coleta | Marca o candidato como `CONSUMIDO` | Volta o candidato para `PENDENTE` |
| 3 | Assistente | Indexa descriÃ§Ã£o/edital (chunks + embeddings) | Remove os chunks da oportunidade |
| 4 | RecomendaÃ§Ãµes + NotificaÃ§Ãµes | RecomendaÃ§Ãµes calcula o pÃºblico-alvo; NotificaÃ§Ãµes prepara agendamentos **pendentes**, identificados por `sagaId` | Cancela os agendamentos pendentes |
| 5 | Oportunidades | `PUBLICADA` + evento pela outbox (**pivÃ´**, sem volta) | â€” |

- O passo 2 Ã© **pulado** quando a oportunidade Ã© cadastrada manualmente (nÃ£o hÃ¡ candidato).
- O fluxo descrito Ã© exclusivamente `RASCUNHO â†’ PUBLICANDO â†’ PUBLICADA`. EdiÃ§Ãµes e encerramentos de oportunidades jÃ¡ publicadas sÃ£o fluxos separados; uma compensaÃ§Ã£o nunca rebaixa uma oportunidade previamente publicada para `RASCUNHO`.
- Os avisos preparados pela SAGA nÃ£o sÃ£o enviados imediatamente. O evento `OportunidadePublicada`, emitido pelo pivÃ´ via Outbox, ativa os agendamentos pendentes; NotificaÃ§Ãµes usa `sagaId` e chaves idempotentes para evitar duplicaÃ§Ã£o.
- Todos os comandos sÃ£o **idempotentes por `sagaId`**: reexecutar um passo nÃ£o duplica efeito.
- O passo 5 Ã© o **pivÃ´**: depois dele a transaÃ§Ã£o Ã© irreversÃ­vel; uma retirada posterior Ã© um novo fluxo (encerramento), nÃ£o compensaÃ§Ã£o.

## 4. Diagrama â€” fluxo de publicaÃ§Ã£o

O diagrama resume o caminho feliz e indica o que acontece se uma etapa falhar antes da publicaÃ§Ã£o. Os detalhes de idempotÃªncia, retentativas e compensaÃ§Ãµes estÃ£o descritos nas seÃ§Ãµes anteriores.

```mermaid
flowchart TD
  A["Admin solicita publicaÃ§Ã£o"] --> B["Oportunidades valida<br/>RASCUNHO â†’ PUBLICANDO"]
  B --> C{"Veio da Coleta?"}
  C -->|"Sim"| D["Coleta marca o candidato<br/>como CONSUMIDO"]
  C -->|"NÃ£o: cadastro manual"| E["Pula etapa de Coleta"]
  D --> F["Assistente prepara conteÃºdo<br/>para recuperaÃ§Ã£o RAG"]
  E --> F
  F --> G["RecomendaÃ§Ãµes calcula<br/>o pÃºblico-alvo"]
  G --> H["NotificaÃ§Ãµes prepara<br/>agendamentos pendentes"]
  H --> I["Oportunidades confirma<br/>PUBLICADA + evento na outbox"]
  I --> J["OportunidadePublicada<br/>Ã© entregue pelo RabbitMQ"]
  J --> K["NotificaÃ§Ãµes ativa<br/>agendamentos idempotentemente"]
  J --> L["Projetor CQRS atualiza<br/>OpenSearch"]
  J --> M["RecomendaÃ§Ãµes e Engajamento<br/>atualizam suas projeÃ§Ãµes"]

  B -. "falha antes do pivÃ´" .-> X["Retentativas; se esgotadas,<br/>compensar e registrar falha"]
  D -. "falha antes do pivÃ´" .-> X
  F -. "falha antes do pivÃ´" .-> X
  G -. "falha antes do pivÃ´" .-> X
  H -. "falha antes do pivÃ´" .-> X

  classDef acao fill:#ffffff,stroke:#2e7d32,color:#333
  classDef decisao fill:#fff8e1,stroke:#f9a825,color:#333
  classDef evento fill:#e3f2fd,stroke:#1565c0,color:#333
  classDef falha fill:#fce4ec,stroke:#c2185b,color:#333
  class A,B,D,E,F,G,H,I,K,L,M acao
  class C decisao
  class J evento
  class X falha
```

### Como explicar o diagrama

- Oportunidades coordena o fluxo e mantÃ©m o estado da SAGA.
- Se a oportunidade veio da Coleta, o candidato Ã© marcado como consumido; no cadastro manual, essa etapa Ã© pulada.
- Antes do pivÃ´, o Assistente prepara o conteÃºdo para RAG, RecomendaÃ§Ãµes calcula o pÃºblico-alvo e NotificaÃ§Ãµes prepara os agendamentos sem enviar avisos ainda.
- O pivÃ´ Ã© a confirmaÃ§Ã£o `PUBLICADA` com o evento registrado na outbox. Depois disso, uma falha de consumidor Ã© resolvida por retentativa/reprocessamento; nÃ£o se compensa a publicaÃ§Ã£o voltando para rascunho.
- O evento ativa os agendamentos e atualiza as projeÃ§Ãµes, incluindo o Ã­ndice OpenSearch do CQRS.
- Se uma etapa falhar antes do pivÃ´ e as retentativas se esgotarem, Oportunidades compensa as etapas jÃ¡ concluÃ­das em ordem reversa. Por exemplo, pode liberar o candidato para voltar a `PENDENTE` e remover os chunks preparados no Assistente.

## 5. Exemplo de falha com compensaÃ§Ã£o

Se o provedor de embeddings ficar indisponÃ­vel, Oportunidades tenta novamente com backoff. Se as tentativas se esgotarem antes do pivÃ´, a SAGA desfaz as etapas jÃ¡ concluÃ­das: remove os chunks preparados no Assistente, libera o candidato da Coleta quando houver um e registra a publicaÃ§Ã£o como compensada. O painel informa ao administrador que a publicaÃ§Ã£o falhou. A oportunidade permanece em `RASCUNHO` porque ainda nÃ£o chegou ao estado `PUBLICADA`.

## 6. Estados da SAGA

| Estado | Significado |
|---|---|
| `INICIADA` | Registro criado, passo 1 concluÃ­do |
| `EM_ANDAMENTO` | Executando os passos da SAGA antes do pivÃ´ |
| `COMPENSANDO` | Um passo falhou; desfazendo os anteriores |
| `COMPENSADA` | CompensaÃ§Ã£o concluÃ­da; oportunidade de volta a `RASCUNHO` |
| `CONCLUIDA` | Passo pivÃ´ executado; oportunidade `PUBLICADA` |
| `FALHA_COMPENSACAO` | A prÃ³pria compensaÃ§Ã£o falhou; exige intervenÃ§Ã£o manual e gera alerta |

---

## 4.7 CQRS

> **Status:** proposta arquitetural â€” padrÃ£o ainda nÃ£o implementado.

O CQRS (*Command Query Responsibility Segregation*) separa as operaÃ§Ãµes que modificam dados das operaÃ§Ãµes que consultam dados.

No ConectaU, o padrÃ£o Ã© aplicado ao **serviÃ§o de Oportunidades**, dono do catÃ¡logo oficial.

## 1. Por que aqui

Ã‰ o serviÃ§o com a **maior razÃ£o leitura/escrita** da plataforma: muitos estudantes buscando, poucos admins escrevendo. E os dois lados tÃªm exigÃªncias opostas:

- **Escrita:** cadastrar, editar, publicar e encerrar. Precisa validar regras (prazo â‰¥ data de inÃ­cio, transiÃ§Ãµes de status vÃ¡lidas, apenas `ADMIN`) e preservar integridade.
- **Leitura:** pesquisar por texto livre, filtrar por campus, categoria e prazo, ordenar por relevÃ¢ncia. Precisa ser rÃ¡pida e tolerar desnormalizaÃ§Ã£o.

A combinaÃ§Ã£o de busca textual, filtros e ordenaÃ§Ã£o por relevÃ¢ncia justifica o uso do OpenSearch como modelo de leitura especializado. Embora o PostgreSQL tambÃ©m ofereÃ§a recursos para essas consultas, a separaÃ§Ã£o permite otimizar a busca sem comprometer as responsabilidades de integridade e transaÃ§Ã£o do modelo de escrita.

## 2. SeparaÃ§Ã£o dos modelos

Diferente de versÃµes anteriores desta proposta, os dois modelos usam **tecnologias distintas**:

| | Modelo de escrita | Modelo de leitura |
|---|---|---|
| Tecnologia | PostgreSQL normalizado | **OpenSearch** |
| ConteÃºdo | `oportunidades`, `saga_publicacao`, `outbox` | `oportunidades_view`: documento desnormalizado com texto completo, campus, categoria, curso-alvo, prazo, popularidade e status de visibilidade; o Ã­ndice pÃºblico contÃ©m apenas `PUBLICADA` |
| Otimizado para | Invariantes e transaÃ§Ãµes | Busca full-text, filtros facetados, ordenaÃ§Ã£o |
| Quem escreve | Comandos do ADMIN e a SAGA | Apenas o projetor de eventos |

```mermaid
flowchart TD
    ADM["Admin (via BFF Admin)"] --> CMD["Modelo de escrita<br/>Commands"]
    EST["Estudante (via BFF Web)"] --> QRY["Modelo de leitura<br/>Queries"]

    CMD --> RULES["ValidaÃ§Ã£o das regras<br/>de negÃ³cio"]
    RULES --> DB[("PostgreSQL<br/>escrita + outbox")]

    DB --> RELAY["Relay da outbox"]
    RELAY --> MQ[("RabbitMQ")]
    MQ --> PROJ["Projetor"]
    PROJ --> OS[("OpenSearch<br/>oportunidades_view")]
    OS --> QRY

    QRY --> RESULT["Feed, busca<br/>e filtros"]

    style CMD fill:#fbe5e5,stroke:#c0392b,color:#333
    style QRY fill:#e2f0ff,stroke:#2471a3,color:#333
    style DB fill:#e8e8e8,stroke:#666,color:#333
    style OS fill:#dff2df,stroke:#27833b,color:#333
```

## 3. Fluxo de atualizaÃ§Ã£o

1. Um comando chega Ã  API (`POST`/`PATCH /api/v1/oportunidades`, ou um passo da SAGA).
2. O modelo de escrita valida e grava no PostgreSQL â€” **na mesma transaÃ§Ã£o**, insere o evento na tabela `outbox` ([4.5](#45-dados-consistencia-eventual-e-outbox)).
3. O relay publica o evento no RabbitMQ.
4. O **projetor** consome `OportunidadeCriada`, `OportunidadeEditada`, `OportunidadePublicada` ou `OportunidadeEncerrada` e atualiza o modelo de leitura. O Ã­ndice consultado pelo pÃºblico contÃ©m **somente oportunidades em `PUBLICADA`**: criar um rascunho nÃ£o o torna visÃ­vel. Eventos de encerramento removem a oportunidade do Ã­ndice pÃºblico (ou a marcam como nÃ£o pesquisÃ¡vel), e eventos de ediÃ§Ã£o reavaliam sua visibilidade.
5. As consultas passam a refletir a alteraÃ§Ã£o.

O uso da **Transactional Outbox** nÃ£o Ã© opcional neste fluxo: sem ela, uma alteraÃ§Ã£o poderia ser gravada sem que o evento correspondente fosse publicado, e o Ã­ndice ficaria permanentemente divergente do banco de escrita.

Como a entrega Ã© *at-least-once*, o projetor Ã© **idempotente**: o upsert usa o `id` da oportunidade como chave do documento, e eventos repetidos apenas reescrevem o mesmo conteÃºdo. Eventos fora de ordem sÃ£o descartados comparando um nÃºmero de versÃ£o do registro.

## 4. ConsistÃªncia eventual

| Aspecto | DefiniÃ§Ã£o |
|---|---|
| **Meta inicial** | AtÃ© 5 segundos para refletir alteraÃ§Ãµes em condiÃ§Ãµes normais |
| **Tipo de consistÃªncia** | Eventual: os modelos convergem apÃ³s o processamento das atualizaÃ§Ãµes pendentes |
| **Tratamento de falhas** | Novas tentativas, descarte de eventos duplicados, *dead letter queue* e reprocessamento |
| **ReconstruÃ§Ã£o** | O Ã­ndice de leitura Ã© descartÃ¡vel: pode ser recriado do zero relendo o PostgreSQL de escrita, incluindo apenas registros cujo status atual seja `PUBLICADA` no Ã­ndice pÃºblico |

O prazo de cinco segundos Ã© um **objetivo de projeto**, ainda nÃ£o validado por testes; em falha ou sobrecarga, pode levar mais tempo.

**ConsequÃªncia assumida:** logo apÃ³s um admin editar ou encerrar uma oportunidade, o feed pode exibir por alguns segundos a versÃ£o anterior (incluindo a remoÃ§Ã£o pendente de uma oportunidade encerrada). Ã‰ aceitÃ¡vel porque o dado definitivo estÃ¡ sempre no canal oficial, acessÃ­vel pelo link `fonteOficial`.

## 5. BenefÃ­cios esperados

| BenefÃ­cio | AplicaÃ§Ã£o no ConectaU |
|---|---|
| SeparaÃ§Ã£o de responsabilidades | Escrita protege invariantes; leitura serve o feed |
| Consultas otimizadas | Busca textual e filtros em um Ã­ndice feito para isso |
| Escala independente | O lado de leitura escala com a demanda dos estudantes sem afetar a escrita |
| ResiliÃªncia | Uma sobrecarga de leitura nÃ£o compromete a publicaÃ§Ã£o |

## ConclusÃ£o

A adoÃ§Ã£o do CQRS em Oportunidades equilibra integridade de escrita e eficiÃªncia de consulta: PostgreSQL para comandos, OpenSearch para queries, e sincronizaÃ§Ã£o assÃ­ncrona via outbox com meta de defasagem de 5 segundos. A implementaÃ§Ã£o e a validaÃ§Ã£o do comportamento ocorrerÃ£o nas prÃ³ximas etapas do projeto.

---

## VisÃ£o integrada da arquitetura

Em conjunto, as decisÃµes definem o seguinte fluxo geral:

1. O Portal Web e o Painel Admin acessam o sistema pelo API Gateway.
2. O Gateway encaminha as requisiÃ§Ãµes para o serviÃ§o de Identidade ou para o BFF correspondente, conforme a rota.
3. Os BFFs agregam as informaÃ§Ãµes necessÃ¡rias e chamam os serviÃ§os de domÃ­nio, sem assumir a propriedade dos dados ou das regras de negÃ³cio.
4. Cada microsserviÃ§o mantÃ©m seu prÃ³prio armazenamento; integraÃ§Ãµes assÃ­ncronas e cÃ³pias locais sÃ£o realizadas por eventos.
5. O serviÃ§o de Oportunidades coordena a SAGA de publicaÃ§Ã£o e aplica CQRS para separar escrita e pesquisa.
6. A Transactional Outbox registra eventos junto Ã s alteraÃ§Ãµes de negÃ³cio; o relay os publica no RabbitMQ para os consumidores atualizarem suas projeÃ§Ãµes e executarem aÃ§Ãµes.

## ReferÃªncia tÃ©cnica complementar

- [`openapi.yaml`](docs/arquitetura/openapi.yaml) â€” contrato formal OpenAPI 3.0.3, com rotas, parÃ¢metros, schemas e respostas.
