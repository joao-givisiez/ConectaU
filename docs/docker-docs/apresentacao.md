ConectaU

Containerização e Orquestração

Integrantes: Guilherme, Maria, João e Gustavo

Disciplina: Sistemas Distribuídos — UFLA

⸻

1. Introdução e arquitetura

O ConectaU é um projeto que busca conectar estudantes universitários a oportunidades acadêmicas e profissionais.

Nesta etapa, trabalhamos na containerização e organização da infraestrutura da aplicação, utilizando Docker e Docker Compose. Também desenvolvemos uma implementação complementar com Kubernetes.

Arquitetura da solução

A infraestrutura contempla microsserviços, BFFs, clientes web, bancos de dados, mensageria e um Gateway para direcionamento das requisições.

flowchart TD

    A[Usuário] --> B[Gateway / Traefik]
    B --> C[Portal Web]
    B --> D[Painel Admin]
    B --> E[BFF Web]
    B --> F[BFF Admin]
    E --> G[Microsserviços]
    F --> G
    G --> H[(Bancos de dados)]
    G --> I[RabbitMQ]

Tecnologias utilizadas:

* Docker e Docker Compose;
* Node.js 22 e PostgreSQL 17;
* MongoDB e RabbitMQ;
* Traefik;
* Kubernetes e Kustomize.

⸻

1. Dockerfiles e construção das imagens

Foram criados Dockerfiles personalizados para os microsserviços, BFFs, clientes web e componentes de infraestrutura.

Aplicações Node.js

Os cinco microsserviços e os dois BFFs utilizam Node.js 22 com Alpine Linux e a estratégia de multi-stage build.

Recurso	Finalidade
npm ci	Instalar dependências conforme o lockfile.
TypeScript	Verificar os tipos do código.
esbuild	Empacotar o código para execução.
USER node	Executar sem privilégios de root.
HEALTHCHECK	Verificar a disponibilidade pelo endpoint /health.

A primeira etapa realiza a instalação e construção da aplicação. A segunda contém somente os arquivos necessários para sua execução.

Os clientes web utilizam Nginx Unprivileged, pois são compostos por arquivos estáticos.

Imagens da infraestrutura

Também foram criadas imagens personalizadas para PostgreSQL, MongoDB, RabbitMQ e Gateway, incorporando seus respectivos esquemas, scripts e configurações.

⸻

1. Orquestração com Docker Compose

O Docker Compose organiza a infraestrutura em um único arquivo de configuração, permitindo construir e iniciar os componentes do sistema.

Serviços configurados

Foram definidos 18 serviços, distribuídos entre:

* Cinco microsserviços;
* Dois BFFs;
* Dois clientes web;
* Seis bancos de dados;
* RabbitMQ;
* Gateway;
* Projetor de Oportunidades.

Redes e persistência

Foram criadas redes específicas para separar a comunicação entre a borda, aplicação, mensageria e bancos de dados.

As redes de dados são isoladas, permitindo que cada serviço acesse somente seu respectivo banco.

Também foram configurados volumes nomeados para preservar os dados dos bancos e do RabbitMQ.

Variáveis de ambiente e inicialização

As configurações e credenciais são disponibilizadas por variáveis de ambiente. Os arquivos com informações sensíveis não são versionados no Git.

Para construir e iniciar a infraestrutura:

docker compose up -d --build

⸻

1. Persistência e monitoramento

Foram implementados mecanismos para preservar os dados e verificar a disponibilidade dos componentes.

Healthchecks

Componente	Verificação
Microsserviços e BFFs	Requisição HTTP ao endpoint /health.
Clientes web	Requisição HTTP ao endpoint /health.
PostgreSQL	Comando pg_isready.
MongoDB	Operação de ping.
RabbitMQ	rabbitmq-diagnostics.
Gateway	Verificação de saúde do Traefik.

O Docker Compose também utiliza condições de dependência para aguardar a disponibilidade de bancos de dados e do RabbitMQ antes de iniciar os serviços que dependem deles.

Os volumes nomeados permitem preservar os dados mesmo após a remoção e recriação dos containers, desde que sejam mantidos.

⸻

1. Kubernetes, Ingress e escalabilidade

Além do Docker Compose, foi desenvolvida uma implementação complementar com Kubernetes, utilizando Kustomize para organizar os recursos.

Recursos utilizados

Recurso	Finalidade
Namespace	Organizar os recursos do ConectaU.
ConfigMap e Secret	Disponibilizar configurações e credenciais.
Deployment	Gerenciar os Pods das aplicações.
Service	Disponibilizar acesso estável aos Pods.
StatefulSet e PVC	Gerenciar componentes com armazenamento persistente.
Ingress e Middleware	Configurar o acesso e o roteamento das requisições.

Os microsserviços, BFFs e clientes utilizam Deployments e Services. Os bancos de dados e o RabbitMQ utilizam StatefulSets e armazenamento persistente.

Ingress e Traefik

O Traefik atua como Ingress Controller, direcionando as requisições aos serviços correspondentes conforme as regras configuradas.

Também foram implementados middlewares para autenticação, controle de acesso e limitação de requisições.

Escalabilidade horizontal

A infraestrutura permite ajustar a quantidade de réplicas dos serviços por meio do Kubernetes.

kubectl scale deployment identidade --replicas=3 -n conectau

Esse recurso permite aumentar ou reduzir a quantidade de Pods conforme a necessidade.

⸻

1. Conclusão

A etapa permitiu aplicar conceitos de containerização e orquestração em uma arquitetura composta por múltiplos serviços.

Foram implementadas imagens personalizadas, redes isoladas, volumes persistentes, mecanismos de monitoramento e inicialização centralizada com Docker Compose.

Como complemento, o Kubernetes possibilitou explorar recursos de gerenciamento, configuração, roteamento e escalabilidade.

Com isso, o ConectaU passou a contar com uma infraestrutura organizada para executar e gerenciar seus diferentes componentes.
⸻

1. Demonstração prática

O vídeo apresenta a infraestrutura do ConectaU, incluindo a construção das imagens, a inicialização dos serviços e os recursos de containerização e orquestração implementados.

Assistir à demonstração do ConectaU