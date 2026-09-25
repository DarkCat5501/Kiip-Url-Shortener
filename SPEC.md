# Encurtador de links com estatísticas

Que bom ter você aqui. Pense neste desafio como uma conversa sobre código, só que começando por escrito: descrevemos um problema, você resolve do jeito que considera certo, e depois senta com a gente para contar por que fez daquela forma.
O problema é um encurtador de links com estatísticas de acesso, e o domínio é simples de propósito: o que interessa não é o que a aplicação faz, e sim as decisões que ela exige de você para funcionar na escala descrita abaixo.
Não tem pegadinha de algoritmo nem prova de memória. Dizemos o que o sistema precisa fazer e em que escala vai rodar, mas não dizemos como construir. Essa parte é sua, e é justamente o que queremos ver: como você decide aquilo que o enunciado deixou em aberto. É assim que o trabalho é aqui no dia a dia.

## 1. A escala em que esse serviço roda

Este é o contexto mais importante do desafio. Trate os números abaixo como o cenário real de produção:

- 100 milhões de redirects por mês, algo em torno de 40 por segundo na média
- 3 mil/s de pico de redirects, quando um link viraliza
- 20 mil links novos por dia
- 10 milhões + de acessos acumulados nos links mais populares, cada um
- 50 ms é a meta de tempo de resposta do redirect no percentil 95

Ou seja: para cada link criado existem milhares de redirects. A leitura domina com folga.

> Você não precisa provar essa escala. Não espere teste de carga, e não vamos medir throughput da sua
> entrega. O que vamos olhar é se as suas decisões de arquitetura, modelagem e infraestrutura fazem
> sentido para esses números, e se você explicou essas decisões no README.

## 2. O que já está definido


| CAMADA | DEFINIDO |
|---|---|
| Linguagem|Node.js com TypeScript |
| Backend| NestJS |
| Banco|PostgreSQL, com Prisma como ORM |
| Front|React (Vite, Next.js, o que você preferir) |
| Execução|Docker Compose, porque precisamos conseguir subir sua solução na nossa máquina |


O resto da arquitetura é sua escolha. Se a sua solução precisar de outras peças, inclua no Compose e conte no
`README` por que precisou delas. Se decidir que não precisa de nenhuma, também está ótimo, desde que você
explique o raciocínio.

## 3. Requisitos funcionais

1. Criar link: POST /links
  Recebe url (obrigatória e validada), e opcionalmente slug , expiresAt e maxClicks .
  Sem slug informado, gere um curto e único.
  slug customizado que já exista deve falhar com erro claro, nunca sobrescrever.
  A resposta devolve a URL curta completa, pronta para usar.

2. Redirecionar: GET /{slug}
  Responde 302 para a URL de destino.
  Link desativado, expirado, ou que já atingiu maxClicks , responde 410 Gone .
  slug inexistente responde 404 .
  É este o endpoint que recebe os 3 mil acessos por segundo, com a meta de 50 ms.

3. Registro de acesso
  Todo acesso a um link precisa ser registrado individualmente, com data e hora, referer e user-
  agent .
  Registrar o acesso não pode comprometer a meta de tempo de resposta do redirect.
  Uma falha ao registrar o acesso não pode impedir a pessoa de chegar ao destino.

4. Estatísticas:GET /links/{slug}/stats
  Total de acessos do link.
  Série diária dos últimos 7 dias.
  Os 20 acessos mais recentes, com data e hora, referer e user-agent .
  Precisa responder rápido também para um link com dez milhões de acessos.

5.  Desativar link:PATCH /links/{slug}
  Permite desativar o link.
  O efeito no redirect precisa ser imediato.

6. Limite de criação
  A criação de links precisa ter limite de requisições por IP, para não virar porta aberta de abuso.

7. Interface web
  Formulário para criar um link.
  Lista dos links criados, com o total de acessos de cada um.
  Visualização das estatísticas de um link.
  Não precisa ser bonita. Precisa funcionar. O peso do front aqui é pequeno de propósito.

## 4. Requisitos não funcionais

Sobe com um comando. docker compose up precisa levantar a solução inteira, com todos os serviços que
ela usar. Sem passo manual escondido.
Migrations versionadas no repositório.
Testes automatizados cobrindo as regras de negócio, e pelo menos um teste de integração ou e2e no fluxo
de redirect.
Configuração por ambiente, com um .env.example no repositório e nenhum segredo comitado.
`README` explicando como subir, como rodar os testes, e quais decisões você tomou e por quê.


## 5. O que não precisa

Para deixar claro onde não gastar suas horas:

- Autenticação e cadastro de usuário. Não faz parte do desafio.
- Deploy em nuvem. Rodar local via Compose basta.
- Design apurado. Front funcional resolve.
- Teste de carga. A escala é contexto para as suas decisões, não uma meta a comprovar.
- Multi tenant, painel administrativo, CI, domínio próprio. Fora de escopo.

## 6. Sobre usar IA

A Kiip nasceu na era pós-IA e usa IA nativamente em tudo o que faz. Aqui não é diferente: você pode e
deve usar IA neste desafio. Duas condições:

> Declare no `README` onde usou e para quê.
> Você vai defender cada decisão numa conversa depois da entrega. Código que você não sabe explicar
> conta contra, tenha vindo de onde tiver vindo.

7. Como avaliamos

|EIXO|O QUE OLHAMOS|
|---|---|
|Escala|Se as decisões de arquitetura conversam com os números da seção 1|
|Regra de negócio|Os casos de borda foram pensados, ou só o caminho feliz funciona|
|Modelagem|Como o schema representa o domínio, e se as consultas que ele exige são viáveis|
|Testes|O que você escolheu testar, e se os testes pegariam uma regressão|
|Código|Organização, limites entre camadas, legibilidade|
|Front|Funciona de ponta a ponta|
|Comunicação|O `README` explica as decisões de forma clara e honesta|


Um aviso de transparência: duas coisas reprovam o desafio independente de todo o resto. A solução não subir
pelo Compose, e não existir nenhum teste automatizado.

## 8. Entrega

Repositório privado no GitHub, com acesso liberado para quem enviou o desafio. Não publique a solução
em repositório público enquanto o processo seletivo estiver na etapa de teste técnico.
Histórico de commits real, não um commit único com tudo dentro.
Avise quando terminar.
O prazo combinamos direto com você.

> Pode tornar público depois
> A partir de 15/10/2026 você fica livre para tornar o repositório público, caso queira usá-lo como portfólio.
> Nessa data o processo seletivo já não estará mais na etapa de teste técnico.
