# Front-end do ConectaU

Interface única do ConectaU: **portal da comunidade**, **assistente (o agente de IA)** e **curadoria** do administrador, numa só aplicação. HTML, CSS e JavaScript puros, sem etapa de build, no mesmo padrão dos clientes que já existem em [`clients/`](../clients/) (que ficam como estão).

## Como abrir

| Como | Endereço | Observação |
|---|---|---|
| Com o sistema todo (`docker compose up -d --build`) | <http://localhost:8080/app/> | O gateway publica o serviço `frontend` em `/app/`. |
| Em desenvolvimento, contra o sistema que já está rodando | <http://localhost:5173> | `cd frontend && npm run dev` (sem dependências). Repassa `/auth`, `/web` e `/admin` ao gateway (`GATEWAY_URL`, padrão `http://localhost:8080`). |

Quem entra como administrador (`ADMIN_EMAIL` e `ADMIN_SENHA` do `.env`) vê também **Curadoria** no menu. A conta de estudante se cria na própria tela de entrada.

> O portal e o painel antigos continuam em `/` e `/painel/`. Para esta interface virar a página inicial, aponte o serviço `portal-web` de [`dinamico.yml`](../infrastructure/docker/gateway/dinamico.yml) para `http://frontend:8080`. Os manifests de [`infrastructure/kubernetes/`](../infrastructure/kubernetes/) ainda não publicam o `frontend`.

## O que tem

| Tela | Rota na interface | Quem vê |
|---|---|---|
| Oportunidades (feed personalizado ou busca com filtros e paginação) | `#/` | Todos. Logado e sem filtro, vê o feed do próprio perfil. |
| Detalhe da oportunidade: salvar, lembrar do prazo, canal oficial e **o agente restrito àquele edital** | `#/oportunidades/:id` | Todos. As ações aparecem conforme os links HATEOAS da resposta. |
| **Assistente** (conversa geral) | `#/assistente` | Logados. |
| Salvos e lembretes | `#/salvos` | Logados. |
| Avisos (com contador no menu) | `#/avisos` | Logados. |
| Perfil | `#/perfil` | Logados. |
| Entrar e criar conta | `#/entrar` | Anônimos. |
| Curadoria: fila de candidatos, rascunhos, publicação pela SAGA ao vivo, encerradas e fontes de coleta | `#/curadoria/:aba` | Administradores. |

### O assistente na interface

A conversa mostra, para cada resposta, o que o back-end informa: a **origem** (gerada por IA com o nome do modelo, reaproveitada do cache, modo degradado quando o LLM falha, ou recusa por estar fora do escopo), as **fontes citadas** com o trecho usado (os rótulos `[F1]` do texto abrem a fonte), as **ferramentas que o agente consultou** (base de conhecimento, catálogo de oportunidades), a latência e os tokens. Como a API não tem rota para ler o histórico, as trocas também ficam em `sessionStorage`, por usuário.

Enquanto o modelo trabalha, a **semente** (a forma que respira no topo do assistente) acelera: é o estado de carregamento.

## Rotas do back-end que a interface chama

Todas pelo gateway, na mesma origem. O catálogo único está em [`public/js/api.js`](public/js/api.js).

| Porta | Rotas |
|---|---|
| `/auth` | `POST /auth/sessoes`, `POST /auth/usuarios` |
| `/web` | `GET /web/feed`, `GET /web/oportunidades`, `GET /web/oportunidades/:id`, `GET`/`PATCH /web/perfil`, `GET`/`POST /web/favoritos`, `DELETE /web/favoritos/:id`, `GET`/`POST /web/lembretes`, `DELETE /web/lembretes/:id`, `GET /web/notificacoes`, `PATCH /web/notificacoes/:id`, `POST /web/conversas`, `POST /web/conversas/:id/mensagens` |
| `/admin` | `GET`/`POST /admin/fontes`, `GET`/`POST /admin/execucoes`, `GET`/`POST /admin/candidatos`, `GET`/`PATCH /admin/candidatos/:id`, `GET`/`POST /admin/oportunidades`, `GET`/`PATCH`/`DELETE /admin/oportunidades/:id`, `POST /admin/oportunidades/:id/publicacao`, `POST /admin/oportunidades/:id/encerramento`, `GET /admin/publicacoes/:sagaId` |

O gateway limita o assistente a **10 perguntas por minuto** (rajada de 5, por IP). Ao receber `429`, a interface mostra a mensagem em vez de falhar em silêncio.

## Testes

```bash
cd frontend

npm test                      # estático, sem o sistema no ar
npm run test:rotas            # integração: as rotas acima contra o gateway (61 verificações)
node tests/rotas.mjs --saga   # + publica uma oportunidade de teste pela SAGA e a encerra (66 no total)
node tests/rotas.mjs --llm    # + UMA pergunta real ao agente (consome a Groq)

npm i --no-save playwright-core        # só para o roteiro de navegador (não é dependência do projeto)
node tests/navegador.mjs               # ponta a ponta no Edge/Chrome, atrás do gateway
```

- **`tests/rotas.mjs`** importa o mesmo `api.js` da interface: o que ele chama é o que a tela chama. Cobre leitura pública, filtros, cadastro e login, regras de acesso (401/403/404/409/400), favoritos, lembretes, avisos, o assistente (busca vetorial sem modelo, recusa por escopo, conversa de outra conta), a curadoria completa e, com `--saga`, a publicação. As perguntas ao assistente usam `modo: "recuperacao"` e a recusa por escopo, que **não** gastam a Groq. O teste respeita o limite de 10 por minuto do gateway em vez de contorná-lo.
- **`tests/interface.mjs`** confere a sintaxe de todo o JavaScript, os ícones, as classes de CSS, a paleta (nada de branco, preto, cinza ou creme), os cantos (16 a 32 px), o contraste mínimo de 4,5:1 nos pares de texto, a ausência de glifos como ícone, a compatibilidade com a CSP, que nenhum dado do servidor vira HTML, e o cliente da API com `fetch` simulado (429 em texto puro do Traefik, queda de rede, timeout, 401).
- **`tests/navegador.mjs`** percorre a interface de verdade e falha com erro de console, violação da CSP, requisição quebrada, rolagem horizontal no celular ou `null`/`undefined` escritos na tela. Também envia uma resposta de modelo com `<img onerror>` e `<script>` para garantir que **nada executa**.

Os testes de rota deixam para trás contas com e-mail `teste.frontend.*` e `intruso.*`, conversas e, com `--saga`, uma oportunidade **Encerrada** com título `[teste-frontend] …`. Os candidatos manuais de teste ficam como Descartados.

## Segurança

- Todo conteúdo vindo do servidor (títulos, editais, respostas do modelo) entra na página como **texto**. [`ui.js`](public/js/ui.js) não oferece caminho para HTML; o único `innerHTML` do projeto é o dos ícones, que são constantes.
- A [`seguranca.inc`](seguranca.inc) define uma **CSP** restritiva (`default-src 'none'`, sem script, estilo ou evento inline), `nosniff`, `Referrer-Policy: no-referrer` e `Permissions-Policy`. O servidor de desenvolvimento usa os mesmos cabeçalhos.
- Links externos só abrem se forem `http(s)`, com `rel="noopener noreferrer"`. O retorno depois do login só aceita rotas internas.
- O token fica em `sessionStorage` (some ao fechar a aba). O nome mostrado vem do próprio JWT, sem conferir a assinatura: quem confere o token é o gateway, a cada requisição.
- Fontes e ícones são servidos pela própria interface, sem CDN: o navegador não envia dados a outro domínio.

## Direção visual

**Âncora: Organic.** Escolhida no lugar do par seguro (azul e branco de portal acadêmico) porque a UFLA nasceu como escola de agricultura, no sul de Minas, e porque oportunidades têm prazo, que cresce e vence como estação. O ConectaU reúne o que estava espalhado: a interface é terra, não vidro.

**Diferencial: a semente do assistente.** Uma forma orgânica de três camadas (ocre, terracota, sálvia) que respira devagar quando o assistente está parado e depressa enquanto o modelo trabalha. Aparece no topo da página do assistente e dentro de cada edital, e é o carregamento do agente.

| Decisão | Valor |
|---|---|
| Superfícies | Sálvia `#8B9D83`, barro `#B08B6E`, terracota `#C66B3D`, ocre `#C08E3A`, musgo `#606C38`; claras: areia `#E8DCC7` e aveia `#D4B895`. |
| Onde há texto pequeno | A mesma família, escurecida, para passar de 4,5:1: `musgo-fundo #47502A`, `terracota-fundo #9A4720`, `ocre-fundo #7A5410`, `salvia-fundo #4F6149`, `barro-fundo #7A5A40`. Tinta em marrom-terra (`#2E2619`), nunca preto. |
| Tipografia | **Fraunces** (serifa humanista, eixos `SOFT` e `WONK` ligados) nos títulos e **Epilogue** (sans geométrica quente) no texto. Hospedadas em [`public/fontes/`](public/fontes/) (licenças em `LICENCAS.md`). |
| Estrutura | Cantos de 16 a 32 px em tudo, inclusive no topo e na barra do celular, que flutuam com margem. Cartões com cantos alternados (`32 16 32 16`) que se invertem ao passar o mouse. |
| Textura | Grão de papel por ruído fractal (`feTurbulence`) a cerca de 2 %, no CSS. |
| Movimento | Transições de 400 ms com curva suave; a semente respira. Respeita `prefers-reduced-motion`. |
| Ícones | Lucide v0.468.0 em SVG inline ([`icones.js`](public/js/icones.js), gerado dos arquivos oficiais). Nenhum glifo Unicode como ícone. |

Texto na tela: cada rótulo nomeia informação real (dados do back-end ou ajuda que descreve o que o sistema faz, tirada de [`07-assistente-e-seus-limites.md`](../services/assistente/conhecimento/07-assistente-e-seus-limites.md)); ações padrão têm texto padrão (Entrar, Buscar, Salvar, Enviar); nenhum dado fictício é exibido como se fosse real (os exemplos em campos de busca e nas perguntas sugeridas são claramente exemplos).

## Estrutura

```
frontend/
  Dockerfile, nginx.conf, seguranca.inc   imagem nginx sem root, publicada pelo gateway em /app/
  servidor-dev.mjs                        estáticos + proxy para o gateway (npm run dev)
  public/
    index.html
    estilo/   tokens.css · componentes.css · paginas.css
    fontes/   Fraunces e Epilogue (woff2) + LICENCAS.md
    js/
      api.js            cliente e catálogo de rotas (sem window: o teste de rotas o importa)
      sessao.js         token e papel em sessionStorage
      roteador.js       rotas por hash (#/…), com guarda de login e de papel
      ui.js             h() sem HTML, ícones, avisos, diálogo, formatação
      componentes/      cartao · conversa (o agente) · semente
      paginas/          feed · oportunidade · assistente · salvos · avisos · perfil · entrar · curadoria
  tests/                interface.mjs · rotas.mjs · navegador.mjs
```
