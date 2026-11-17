# ConectaU — Arquitetura integrada (proposta revisada)

> Este diagrama consolida em uma única visão os canais de entrada, a camada de borda,
> os serviços de domínio, a coordenação da SAGA, a mensageria e os armazenamentos.
> Ele representa a arquitetura proposta, não uma implementação já executada.

```mermaid
flowchart TB
    %% Canais de entrada
    subgraph CLIENTES["Canais de acesso"]
        WEB["Portal Web<br/>Comunidade"]
        ADMIN["Painel Administrativo"]
    end

    %% Camada de borda
    GW["API Gateway<br/>TLS · autenticação/autorização · rate limit · roteamento"]
    BFFW["BFF Web"]
    BFFA["BFF Admin"]

    WEB --> GW
    ADMIN --> GW
    GW -->|"/web/**"| BFFW
    GW -->|"/admin/**"| BFFA

    %% Serviços
    subgraph APP["Camada de aplicação — serviços internos"]
        direction TB

        subgraph DOMINIO["Microsserviços de domínio"]
            direction LR
            ID["Identidade"]
            OP["Oportunidades<br/>CQRS"]
            CO["Coleta"]
            EN["Engajamento"]
            RE["Recomendações"]
            NO["Notificações"]
            AS["Assistente<br/>RAG"]
        end

        ORQ["Orquestrador da SAGA<br/>coordena a publicação<br/>e mantém o estado da SAGA"]
    end

    BFFW --> ID
    BFFW --> OP
    BFFW --> EN
    BFFW --> RE
    BFFW --> NO
    BFFW --> AS

    BFFA --> ID
    BFFA --> OP
    BFFA --> CO
    BFFA --> ORQ

    %% Coordenação SAGA: chamadas internas, não tráfego público
    ORQ -->|"comando: consumir candidato"| CO
    ORQ -->|"comando: indexar conteúdo"| AS
    ORQ -->|"comando: preparar avisos"| NO
    ORQ -->|"comando: confirmar publicação"| OP

    %% Bancos de dados (database per service)
    DBID[("Banco próprio<br/>Identidade")]
    DBCO[("Banco próprio<br/>Coleta")]
    DBOP[("PostgreSQL<br/>Oportunidades")]
    DBEN[("Banco próprio<br/>Engajamento")]
    DBRE[("Banco próprio<br/>Recomendações")]
    DBNO[("Banco próprio<br/>Notificações")]
    DBAS[("Banco próprio<br/>Assistente")]
    DBORQ[("Banco próprio<br/>Orquestrador SAGA")]
    OS[("OpenSearch<br/>índice de leitura CQRS")]

    ID --- DBID
    CO --- DBCO
    OP --- DBOP
    OP --- OS
    EN --- DBEN
    RE --- DBRE
    NO --- DBNO
    AS --- DBAS
    ORQ --- DBORQ

    %% Eventos e mensageria
    MQ[["RabbitMQ<br/>mensageria de eventos"]]
    OP -->|"Outbox / eventos"| MQ
    CO -->|"Outbox / eventos"| MQ
    ID -->|"Outbox / eventos"| MQ
    MQ --> RE
    MQ --> EN
    MQ --> NO
    MQ -->|"evento de oportunidade publicada"| AS
    MQ -->|"projeção de leitura"| OP

    %% Integrações externas
    FONTES["Sites e portais públicos<br/>da UFLA"]
    LLM["Provedor externo<br/>LLM e embeddings"]
    CO -.->|"coleta de informações"| FONTES
    AS -.->|"requisições de IA"| LLM

    %% Estilos
    classDef client fill:#fff3e0,stroke:#ef6c00,color:#333
    classDef edge fill:#e3f2fd,stroke:#1565c0,color:#333
    classDef service fill:#ffffff,stroke:#2e7d32,color:#333
    classDef orchestrator fill:#f3e5f5,stroke:#7b1fa2,color:#333
    classDef database fill:#e0f2f1,stroke:#00796b,color:#333
    classDef broker fill:#fff8e1,stroke:#f9a825,color:#333
    classDef external fill:#fce4ec,stroke:#c2185b,color:#333

    class WEB,ADMIN client
    class GW,BFFW,BFFA edge
    class ID,OP,CO,EN,RE,NO,AS service
    class ORQ orchestrator
    class DBID,DBCO,DBOP,DBEN,DBRE,DBNO,DBAS,DBORQ,OS database
    class MQ broker
    class FONTES,LLM external
```

## Como interpretar os fluxos

1. **Acesso externo:** Portal Web e Painel Administrativo entram pelo API Gateway. O Gateway encaminha as rotas aos BFFs correspondentes; os BFFs compõem as chamadas aos serviços internos.
2. **SAGA de publicação:** o pedido administrativo chega pela camada de entrada. O Orquestrador da SAGA coordena os comandos internos para Coleta, Assistente, Notificações e Oportunidades. O serviço Oportunidades continua sendo o proprietário da regra de domínio que efetiva a transição para `PUBLICADA` e registra o evento correspondente em sua Outbox.
3. **Eventos:** serviços publicam eventos por meio do padrão Outbox; o RabbitMQ transporta esses eventos aos consumidores interessados.
4. **Dados:** cada serviço mantém seu armazenamento próprio. O PostgreSQL e o OpenSearch aparecem em Oportunidades por causa do CQRS; o Orquestrador mantém armazenamento separado para o estado e o histórico da SAGA.

## Observações para validação com a documentação detalhada

- Os nomes e tecnologias dos bancos dos demais serviços devem ser conferidos no documento 4.5 antes de congelar o desenho.
- A ligação do RabbitMQ ao Assistente e o fluxo exato de atualização do índice OpenSearch devem ser confirmados com os documentos 4.5, 4.6 e 4.7.
- As setas entre BFFs e serviços representam chamadas internas. O Gateway é a entrada do tráfego externo; não é necessário fazer toda comunicação serviço-a-serviço passar por ele.
- As chamadas do Orquestrador aos participantes da SAGA são internas e não devem ser expostas como rotas públicas do Gateway.
- O diagrama deve ser ajustado após a leitura dos documentos originais, para preservar nomes, eventos, compensações e decisões já aprovadas pelo grupo.
