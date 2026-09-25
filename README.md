# KIIP - Encurtador de Links com Estatísticas

Desafio técnico para a vaga de Desenvolvedor(a) Fullstack na Kiip.

## Como Rodar

### Pré-requisitos

- Docker e Docker Compose
- Bun (opcional, para desenvolvimento local)

### Com Docker (recomendado)

```bash
# Clone o repositório
git clone https://github.com/DarkCat5501/Kiip-Url-Shortener.git
cd kiip

# Suba tudo
docker compose up -d --build
```

Serviços disponíveis:
- **Backend**: http://localhost:3000
- **Frontend**: http://localhost:5173
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

### Desenvolvimento Local

O `.env` só é necessário para rodar localmente (fora do Docker) — no `docker compose up`, todas as variáveis já são definidas diretamente em `environment:` no `docker-compose.yml`, então nenhuma configuração extra é necessária.

```bash
# Copie o exemplo na raiz e ajuste os valores se necessário
cp .env.example .env
```

Existe um único `.env` para o monorepo inteiro, na raiz do projeto. `apps/backend/.env` e `apps/frontend/.env` são **symlinks** para esse arquivo (`../../.env`), não cópias — então basta editar o `.env` da raiz uma vez e as duas variáveis relevantes (ex: `VITE_API_URL` para o frontend, `DATABASE_URL`/`REDIS_HOST` para o backend) já ficam disponíveis nos dois apps, sem precisar manter dois arquivos sincronizados.

Os symlinks não são versionados no Git (cada `.env` é local), então crie-os a partir da raiz do repositório:

```bash
ln -s ../../.env apps/backend/.env
ln -s ../../.env apps/frontend/.env
```

```bash
# Instale dependências
bun install

# Suba apenas banco e cache
docker compose up -d postgres redis

# Rode migrations
cd apps/backend && bunx prisma migrate deploy

# Inicie em modo dev
bun dev:backend  # Terminal 1
bun dev:frontend # Terminal 2
```

## Como Rodar os Testes

```bash
cd apps/backend && bun run test
cd apps/backend && bun run test:e2e
cd apps/backend && bun run test:cov
```

### O que é testado

- **Unitários**: Regras de negócio do `LinksService` (criação, validação, desativação/reativação, cache)
- **E2E**: Fluxo completo de redirect (criar link → redirecionar → verificar stats → desativar)

### Scripts de stress test

Em `scripts/` (executáveis via `bun run` diretamente):

| Script | Uso |
|---|---|
| `stress-test.ts` | Testa redirect, stats, listagem e criação com carga distribuída entre múltiplos slugs |
| `hit-slug.ts` | Concentra carga máxima num único slug (`bun run hit-slug.ts <slug> --duration <s> --connections <n>`) |
| `hit-multi.ts` | Mede a latência de um slug alvo enquanto outros 10 slugs recebem carga simultânea (`bun run hit-multi.ts <slug> <duration> <connections>`) |
| `hit-with-creates.ts` | Redirect concorrente com criação de links, para validar que o pipeline de flush aguenta os dois ao mesmo tempo (`bun run hit-with-creates.ts <slug> <duration> <create-rate>`) |
| `deactivate.ts` | Testa desativação de link e invalidação imediata do cache (`bun run deactivate`) |
| `setup.ts` / `cleanup.ts` | Popula/limpa dados de teste (`bun run setup` / `bun run cleanup`) |

## Estrutura do Código

```
kiip/
├── apps/
│   ├── backend/        # NestJS API
│   └── frontend/       # React + Vite
├── scripts/            # Scripts de stress test e diagnóstico
├── docker-compose.yml
├── .env.example
└── README.md
```

### Backend

```
apps/backend/src/
├── main.ts              # Bootstrap da aplicação
├── app.module.ts        # Módulo raiz
├── prisma/              # Serviço de banco de dados
├── redis/               # Serviço de cache (Redis)
├── links/               # CRUD de links, cache L1 em memória, paginação
├── redirect/             # Endpoint de redirect, buffer de logs e contador de cliques
└── stats/               # Estatísticas
```

### Frontend

```
apps/frontend/src/
├── main.tsx             # Entry point
├── App.tsx              # Componente raiz
├── lib/api.ts           # Cliente da API
└── components/
    ├── CreateLink.tsx   # Formulário de criação
    ├── LinkList.tsx     # Lista de links (paginação/busca/ordenação refletidas na URL)
    └── LinkStats.tsx    # Visualização de stats
```

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /links | Criar link encurtado |
| GET | /links | Listar links (paginado, com busca e ordenação) |
| GET | /links/:slug | Buscar link por slug |
| GET | /links/:slug/stats | Estatísticas do link |
| PATCH | /links/:slug | Ativar ou desativar link (`{"active": boolean}`) |
| GET | /:slug | Redirecionar para URL original |

### Exemplos de Uso

```bash
# Criar link
curl -X POST http://localhost:3000/links \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Criar com slug customizado
curl -X POST http://localhost:3000/links \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "slug": "meulink"}'

# Acessar link (redirect 302)
curl -I http://localhost:3000/meulink

# Listar com busca, ordenação e paginação
curl "http://localhost:3000/links?q=meu&sortField=clickCount&sortOrder=desc&page=1&pageSize=20"

# Ver estatísticas
curl http://localhost:3000/links/meulink/stats

# Desativar link
curl -X PATCH http://localhost:3000/links/meulink -H "Content-Type: application/json" -d '{"active": false}'

# Reativar link (falha com 422 se maxClicks já foi atingido)
curl -X PATCH http://localhost:3000/links/meulink -H "Content-Type: application/json" -d '{"active": true}'
```

## Stack

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Backend | NestJS + TypeScript | Framework modular com DI, fácil de testar e manter |
| ORM | Prisma v5 | Typesafe, migrations versionadas, bom DX |
| Banco | PostgreSQL 17 | Robusto, suporte nativo a JSON, índices eficientes e identity columns |
| Cache | Redis 7 + cache local em memória (LRU) | Redirects rápidos sem hit no banco para URLs populares |
| ID Generator | nanoid | URL-safe, curto (7 chars), colisões mínimas, sem dependência de DB |
| Frontend | React + Vite + TypeScript | Hot reload rápido, build otimizado, ecossistema maduro |
| Runtime | Bun | Runtime mais rápido para JavaScript/TypeScript |
| Compilador | SWC | ~20x mais rápido que tsc para compilação |
| Container | Docker Compose | Setup completo com um comando |

## Decisões de Arquitetura

### 1. Estrutura do Projeto (Monorepo)

**Por quê monorepo?** Backend e frontend compartilham o mesmo repositório, facilitando versionamento e deploy conjunto no cenário deste desafio técnico. Cada app mantém suas dependências isoladas e pode ser extraído para um repositório próprio caso backend e frontend passem a evoluir em times e ritmos diferentes.

### 2. Modelagem do Banco

```sql
-- links
id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY
slug        VARCHAR(10) UNIQUE  -- identificador público
url         TEXT                -- URL de destino
active      BOOLEAN DEFAULT true
expires_at  TIMESTAMP           -- opcional
max_clicks  INTEGER             -- opcional
click_count INTEGER DEFAULT 0   -- contador denormalizado (ver "3. Estratégia de Cache")
created_at  TIMESTAMP
updated_at  TIMESTAMP

-- access_logs
id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY
link_id     BIGINT FK → links.id
accessed_at TIMESTAMP
referer     TEXT
user_agent  TEXT
ip          VARCHAR(45)
```

**Por quê `id` bigint autoincrement, e não UUID?**
Nenhuma consulta do domínio busca por `id` e não é exigido em nenhum fluxo
O identificador público é sempre o `slug` (curto, único, é o que aparece na URL).
Nesse cenário, UUID só trazia desvantagens: 16 bytes vs. 8 do bigint (dobra o tamanho de cada índice, relevante em `access_logs` com 10M+ linhas por link popular),
sem ganho de segurança (não há enumeração possível via `id`, já que ele nunca é exposto pela API) nem necessidade de geração distribuída
(o `id` só é atribuído no momento em que o Postgres persiste a linha).

`id` nunca aparece em nenhuma resposta da API (ver `LinkResponseDto`) nem é usado como chave no Redis (ver "3. Estratégia de Cache") — é puramente uma otimização de armazenamento interna.

**Por quê `slug` gerado no backend, e não recebido do cliente?**

`nanoid(7)` roda no momento do `POST /links`, no mesmo lugar onde a regra de negócio de unicidade é validada
gerar client-side abriria a porta para o cliente forçar colisões ou contornar validações.

**Por quê tabela separada para access_logs?**

- Separar escrita (alta frequência) de leitura (consultas)
- Permite otimizar índices específicos para cada padrão de acesso
- Facilitar particionamento futuro se necessário

**Por quê `click_count` denormalizado no `links`?**

Calcular o total de cliques via `COUNT(*)` em `access_logs` fica caro para links com milhões de acessos.
`click_count` é mantido via contador no Redis (incrementado a cada redirect) e sincronizado em lote no banco pelo flush periódico.
A leitura de `GET /links` e `GET /links/:slug/stats` nunca faz `COUNT` na tabela de logs.

### 3. Estratégia de Cache

Duas camadas na frente do banco para o hot path do redirect:

- **L1 — memória do processo**: `Map` com LRU (até 1.000 entradas, TTL de 2s). Evita o roundtrip de rede ao Redis para os slugs mais acessados recentemente.
- **L2 — Redis**: chave `link:{slug}` → JSON do link, TTL de 1h. Usado quando o L1 não tem o slug (cache miss local) ou expirou.
- **Miss em ambos**: busca no Postgres e popula os dois níveis.
- **Invalidação**: `LinksService.invalidate(slug)` limpa L1 e L2 juntos — usado tanto por `PATCH /links/:slug` (desativar/reativar) quanto pelo `RedirectService`, ao detectar `expiresAt`/`maxClicks` esgotado durante um redirect.

**Por quê duas camadas?** Medido sob stress test local (1000 conexões concorrentes no mesmo slug): mesmo com Redis saudável, o roundtrip de rede via `ioredis` (conexão TCP única, sem pool) virava fila sob alta concorrência.
O cache L1 elimina esse roundtrip para os slugs mais quentes sem abrir mão do Redis como camada compartilhada entre múltiplas instâncias do backend.

### 4. Contagem de Cliques e Registro de Acesso

O redirect não incrementa `click_count` no Postgres a cada request (isso seria 1 UPDATE por redirect, inviável no pico). Em vez disso:

1. A cada redirect, o slug tem seu contador incrementado atomicamente no Redis (`clicks:{linkId}`, via `INCRBY`).
2. Um flush periódico (a cada 5s, ou quando o buffer de logs atinge 100 itens) agrega os deltas pendentes por link e aplica um único `UPDATE ... FROM UNNEST(...)` no Postgres, cobrindo todos os links do lote numa única query.
3. Enquanto o delta não foi sincronizado, `GET /links` e `GET /links/:slug/stats` somam `click_count` persistido + delta pendente no Redis, então o número exibido é sempre atual mesmo entre flushes.

O log de acesso individual (`access_logs`, usado nas estatísticas detalhadas) segue o mesmo padrão de buffer: o redirect empurra o registro para uma lista Redis (`LPUSH`) e responde ao cliente imediatamente,
sem aguardar a escrita no banco. O flush drena a lista em lotes (`LPOP` com contagem, uma chamada por lote, não item a item) e insere via `createMany`.

**Por quê fire-and-forget de verdade?**
Numa primeira versão, o log e o incremento de clique eram aguardados dentro do handler antes de responder ao cliente, mesmo sendo rápidos individualmente, cada `await` intermediário era engargalado no event loop sob alta concorrência.
A versão atual dispara esse trabalho em background (`Promise.all` sem `await` no caminho de resposta) assim que a URL de destino é conhecida, e a resposta HTTP não espera por ele.

**RISCOS:** simplesmente disparar promises sem await ainda vão abarrotar o event loop porém sem espera do handler, isso pela natureza de trabalaho do Node (ou Bun), idealmente deveríamos ter um processo que cuida apenas de disparo de eventos
com um bus dedicado para logs de acesso e para atualizações.

**Por quê aceitar perda de log em caso de crash?**

Se o processo morre entre o `LPOP` (que já removeu os itens da lista Redis) e o `INSERT` no Postgres, esse lote é perdido
Para dados analíticos (não transacionais), esse é um trade-off aceitável, o redirect em si nunca depende do log ser escrito, e falhas transientes de banco já são retentadas (o `catch` devolve os itens à lista).

### 5. Guard de concorrência nos flushes

Cada flush (de links e de access logs) tem uma flag `isFlushing` que impede execuções sobrepostas do mesmo processo,
o timer periódico e o gatilho por threshold (buffer grande) podiam disparar múltiplos flushes simultâneos sob carga alta,
cada um segurando arrays grandes na heap e essa alta demanda de memória, foi causa raiz de um `OutOfMemory` reproduzido em stress test.
Os flushes também drenam o buffer em lotes limitados (até 1000 itens por vez) em vez de uma leitura ilimitada.

### 6. `active` como fonte de verdade

A coluna `active` no banco reflete tanto desativação manual quanto expiração/esgotamento automático:
quando o redirect detecta que um link expirou (`expiresAt` no passado) ou esgotou `maxClicks`, ele persiste `active=false` no Postgres em
background (fire-and-forget, não bloqueia a resposta 410 ao cliente) além de invalidar o cache.

Isso evita ter que recalcular esse status toda vez que a listagem/detalhe é lido. A única janela residual é um link expirado por data que nunca
mais foi acessado desde então (ninguém disparou a detecção), para esse caso específico, `expiresAt` ainda é comparado na leitura (`isEffectivelyActive`),
já que é uma checagem barata (timestamp) que não depende de nenhum clique ter acontecido.

Reativar um link (`PATCH /links/:slug` com `{"active": true}`) é bloqueado com `422` se `maxClicks` já foi atingido.

### 7. Paginação, busca e ordenação em `GET /links`

`GET /links` aceita `page`, `pageSize` (máx. 100), `q` (busca por slug, `ILIKE`) e `sortField`/`sortOrder` (`createdAt` ou `clickCount`), todos opcionais. A query e a paginação rodam no Postgres (`WHERE`/`ORDER BY`/`LIMIT`/`OFFSET`), não em memória — necessário porque a tabela pode crescer para centenas de milhares de links (20 mil links novos/dia segundo a escala do desafio). A ordenação por `clickCount` usa a coluna persistida (não soma o delta pendente do Redis), então a posição de um link pode ficar levemente atrasada em relação ao clique mais recente — o valor exibido, porém, é sempre o total atualizado.

### 8. Rate Limiting

- Usando `@nestjs/throttler`
- **Limite**: 30 requisições por IP por minuto para `POST /links`
- Armazenado em memória (suficiente para single-instance — ver "Trade-offs e Limitações")

### 9. Geração de Slug

- Usando `nanoid` com alfabeto URL-safe
- Tamanho padrão: 7 caracteres (~3.5 bilhões de combinações)
- Se slug customizado já existe → erro 409 Conflict

## Performance medida

A meta da SPEC é p95 ≤ 50ms no redirect. Os números abaixo, medidos localmente em Docker (ver ressalva em "Carga ideal por instância", logo abaixo), usam p99 como o percentil mais rigoroso disponível no benchmark original
se p99 já está dentro da meta, p95 necessariamente também está.

Testes de carga local (scripts em `scripts/`, ver "Scripts de stress test") contra o backend rodando em Docker, com tráfego distribuído entre 50 slugs (não concentrado num único slug, para não gerar contenção artificial numa única linha/chave):

| Cenário | Resultado |
|---|---|
| 200 conexões concorrentes, sem pipelining HTTP | **p99 = 49ms** (dentro da meta de p95 ≤ 50ms) |
| 500 conexões concorrentes | p99 = 82ms (acima da meta; teto de throughput de 1 instância já atingido) |
| CPU do backend no pico (200 conexões) | ~110% |
| CPU do Postgres no mesmo teste | ~9% (folga grande) |
| CPU do Redis no mesmo teste | ~58-64% (segundo gargalo mais próximo) |

Extrapolando: 1 instância sustenta ~8.3k req/s com p99 dentro da meta, o que já cobre com folga tanto a média (~40 req/s para 100M/mês) quanto o pico de 3k/s da SPEC.
O primeiro recurso a saturar, acima desse throughput, é o CPU do processo Node.
Escalar horizontalmente com múltiplas réplicas atrás de um load balancer é o caminho natural de crescimento, e o Redis (compartilhado entre réplicas) seria o próximo gargalo a observar antes do Postgres.
O gargalo do redis ocorre especialmente pq ele é usado tanto para o mecanismo de cache quando para o mecanimos de fila, em um cenário ideal, um outro mecanismo de fila seria ideial e promoveria uma redução de uso.

**Achado de diagnóstico**: um benchmark inicial usando HTTP pipelining (`pipelining: 10` no autocannon) media p50 de ~1000ms mesmo com o processamento interno do redirect levando ~0.5ms
O pipelining causa head-of-line blocking no cliente de teste (requisições enfileiradas na mesma conexão TCP aguardando a resposta das anteriores), inflando a latência medida sem refletir o comportamento real do servidor.
Os scripts de stress test especificamente usam `pipelining: 1` que reflete como clientes HTTP reais se comportam.

### Carga ideal por instância (dimensionamento para Cloud Run)

A meta da SPEC é **p95 ≤ 50ms** no redirect — não p90 nem p99. `autocannon` (usado pelos scripts de stress) não expõe p95 exato, só p90 e p97.5; usamos p97.5 como proxy conservador (se p97.5 passa, p95 necessariamente passa também).

> A própria SPEC é explícita em não pedir prova de escala via teste de carga. A tabela abaixo é evidência informal, rodada localmente em Docker Compose (não em Cloud Run real, nem em hardware dedicado)
> Serve para embasar a escolha de `concurrency`, não como benchmark formal reprodutível.

Testado localmente com o script `hit-multi` (carga distribuída entre 10 slugs, sem pipelining), variando o número de conexões concorrentes por instância:

| Conexões concorrentes | p90 | p97.5 (proxy de p95) | Resultado |
|---|---|---|---|
| 80 | 30ms | 35ms | Aprovado, com folga |
| 100 | 34ms | 38ms | Aprovado, com folga |
| 120 | 36ms | 45ms | Aprovado, margem estreita |
| 130 | 43ms | 50ms | No limite |
| 140 | 46ms | 56ms | Reprovado |
| 150+ | — | 66-119ms | Reprovado (degrada progressivamente) |

O throughput agregado (req/s) permanece praticamente constante (~6.5-7.4k req/s) em todos os níveis testados — confirma que a instância já satura em CPU a partir de ~50 conexões, e aumentar a concorrência além do ponto de saturação só faz a fila crescer (latência sobe) sem ganho real de throughput.

**Recomendação para Cloud Run**: `concurrency = 100` por instância, como ponto de operação com margem segura antes do limite de 130. Configuração completa:

| Parâmetro | Valor | Motivo |
|---|---|---|
| CPU | 1 vCPU | O processo Node satura em ~1.1-1.2 core no pico — mais que 1 vCPU não ajuda, pois o event loop principal é single-thread |
| Memória | 512Mi–1Gi | Cache L1 (LRU, máx. 1000 entradas) e buffers Redis são leves; memória não é o gargalo observado |
| Concurrency | 100 | Medido acima: mantém p95 (proxy p97.5) < 50ms com margem de segurança |
| Min instances | ≥ 1 | Evita cold start impactar a meta de p95 no redirect |
| Max instances | 5-10 (folga sobre o necessário) | 1 instância a 100 de concurrency já cobre o pico de 3k/s da SPEC (throughput agregado ~7k req/s medido); o teto maior é margem de segurança para picos acima do previsto, não uma necessidade normal |

### Evolução para produção: eliminando a dependência de `setInterval`

`LinksService` e `RedirectService` usam `setInterval` para o flush periódico dos buffers de escrita em lote (links a cada `LINK_FLUSH_INTERVAL_MS`, access logs a cada `ACCESS_LOG_FLUSH_INTERVAL_MS`) — esse timer só existe para persistir dados que já foram aceitos e respondidos ao cliente (padrão write-behind).

**Shutdown**: Cloud Run envia `SIGTERM` e dá [10 segundos por padrão](https://cloud.google.com/blog/topics/developers-practitioners/graceful-shutdowns-cloud-run-deep-dive) antes de forçar `SIGKILL` ao reciclar uma instância. `main.ts` habilita `app.enableShutdownHooks()`, e tanto `LinksService.onModuleDestroy` quanto `RedirectService.onModuleDestroy` fazem um flush final síncrono dos seus buffers nesse momento — sem isso, o `SIGTERM` mataria o processo sem nunca disparar `onModuleDestroy`, deixando qualquer item pendente no buffer Redis até outra instância processá-lo (não é perda de dado — o Redis é compartilhado entre réplicas — mas atrasa a persistência sem necessidade).

Numa instância de produção real, o desenho recomendado seria diferente: remover o `setInterval` e expor um endpoint interno de flush (`POST /internal/flush`, autenticado) disparado por **Cloud Scheduler** em intervalo fixo — ou mover o consumo dos buffers para **Cloud Tasks**/Pub-Sub.

Essa mudança não foi feita neste desafio porque o escopo e o ambiente simulado (`docker compose`, sem Cloud Scheduler disponível) não justificam a complexidade extra — o `setInterval` é suficiente e mais simples de rodar localmente. Fica registrado como o próximo passo natural de arquitetura para produção.

Da mesma forma, a lista do Redis usada como buffer (`LPUSH`/`LPOP`) é adequada para este ambiente simulado, mas não é uma fila de produção: não tem ack, redelivery ou garantia de entrega além do que já está documentado na seção de Trade-offs (perda de lote em caso de crash entre `LPOP` e `INSERT`). Numa instância real, o substituto seria uma fila gerenciada com essas garantias — Pub/Sub, Cloud Tasks ou SQS/BullMQ — naturalmente combinada com o endpoint de flush disparado por Scheduler acima.

## Trade-offs e Limitações

1. **Buffer de logs em memória (Redis)**: em caso de crash do backend entre o `LPOP` e o `INSERT`, um lote de logs pode se perder. Para analytics, isso é aceitável — o redirect nunca depende dessa escrita. Em produção real, uma fila com ack (SQS, BullMQ) removeria essa janela.

2. **Rate limiting em memória**: funciona para single-instance. Para múltiplas réplicas, precisaria de armazenamento distribuído (ex: `@nestjs/throttler` com storage Redis).

3. **Ordenação por `clickCount` usa o valor persistido**, não o total em tempo real (que inclui o delta pendente no Redis) — a posição de um link na lista pode ficar levemente atrasada em relação ao clique mais recente, mas o valor exibido é sempre correto.

4. **Cache L1 em memória por instância**: em múltiplas réplicas, cada uma mantém seu próprio `Map` local. Um `PATCH /links/:slug` limpa o L1 da instância que atendeu a requisição, mas as demais réplicas só percebem a mudança quando seu próprio L1 expira (TTL de 2s) — não há invalidação cross-instância, e resolver isso exigiria pub/sub entre réplicas (ex: Redis `PUBLISH`/`SUBSCRIBE`) para propagar a invalidação. Aceitável dado o volume de escrita (desativação/reativação é rara comparado a redirects) e a janela curta.

5. **Frontend simples**: sem estado global, sem SSR. Para um MVP funcional, é suficiente. Em produção, consideraria React Query para cache de dados e revalidação.

6. **Escala validada para 1 instância**: os números de performance medidos (ver "Performance medida") são de uma única instância do backend. Múltiplas réplicas atrás de um load balancer não foram testadas neste desafio, mas o design (buffer/flush via Redis compartilhado, sem estado local que não seja um cache best-effort) já é seguro para rodar assim.

## Uso de IA

Este projeto foi desenvolvido com assistência de IA para:

- **Scaffolding inicial**: Estrutura do projeto, configuração de Docker
- **Debugging e diagnóstico de performance**: Resolução de erros de compilação/runtime e investigação de latência sob carga
- **Documentação**: Redação do README e comentários

Todas as decisões de arquitetura foram tomadas pelo desenvolvedor, inclusive todas as medidas para validação e testes de carga.

## Licença

Este projeto é privado e parte de um processo seletivo. O código, embora com auxílio de IA, é de autoria pessoal.

Nenhum uso é autorizado sem consentimento prévio e explícito do autor, incluindo mas não se limitando a:

- Reprodução, distribuição ou publicação, total ou parcial, do código
- Uso como exemplo (positivo ou negativo) em treinamentos, artigos, avaliações públicas ou material educacional
- Uso para treino, fine-tuning ou avaliação de modelos generativos/IA
- Reaproveitamento em outros projetos, pessoais ou comerciais

Qualquer solicitação de uso deve ser direcionada diretamente ao autor.
