/**
 * Stress Test Multi-Slug
 *
 * Ataca 10 slugs simultaneamente, mas mede a latência de apenas 1 slug específico.
 * Isso simula um cenário real onde múltiplos links populares estão sendo acessados
 * ao mesmo tempo, e queremos medir a performance de um específico.
 *
 * Uso:
 *   bun run hit-multi.ts <slug-alvo> [duração] [conexões]
 *
 * Exemplo:
 *   bun run hit-multi.ts MxCMMF6 10 200
 *   bun run hit-multi.ts MxCMMF6  # padrão: 10s, 100 conexões
 */

import autocannon from 'autocannon';

// ============================================================
// Configuração
// ============================================================

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TARGET_SLUG = process.argv[2] || 'MxCMMF6';
const DURATION = parseInt(process.argv[3] || '10', 10);
const CONNECTIONS = parseInt(process.argv[4] || '100', 10);

// ============================================================
// Funções auxiliares
// ============================================================

async function checkApiAvailability(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/`);
    return response.ok;
  } catch {
    return false;
  }
}

async function getAuxSlugs(exclude: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/links?pageSize=10`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items.map((l: any) => l.slug).filter((s: string) => s !== exclude);
}

// ============================================================
// Stress Test
// ============================================================

async function runMultiSlugStressTest() {
  console.log('Stress Test Multi-Slug');
  console.log(`  API: ${BASE_URL}`);
  console.log(`  Slug alvo: ${TARGET_SLUG}`);
  console.log(`  Duração: ${DURATION}s | Conexões: ${CONNECTIONS}`);
  console.log('');

  const isAvailable = await checkApiAvailability();
  if (!isAvailable) {
    console.error('API não está disponível em', BASE_URL);
    process.exit(1);
  }
  console.log('API está disponível');

  const SLUGS_TO_HIT = await getAuxSlugs(TARGET_SLUG);
  if (SLUGS_TO_HIT.length === 0) {
    console.error('Nenhum link auxiliar encontrado. Rode `just stress-setup` primeiro.');
    process.exit(1);
  }
  console.log(`  Slugs auxiliares: ${SLUGS_TO_HIT.join(', ')}`);
  console.log('');

  // Criar autocannon para o slug alvo (com medição)
  const targetInstance = autocannon({
    url: `${BASE_URL}/${TARGET_SLUG}`,
    duration: DURATION,
    connections: CONNECTIONS,
    pipelining: 1,
    requests: [
      {
        method: 'GET',
        path: `/${TARGET_SLUG}`,
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'autocannon-target',
        },
      },
    ],
  });

  // Criar autocannons para slugs auxiliares (sem medição detalhada)
  const auxInstances = SLUGS_TO_HIT.map((slug) =>
    autocannon({
      url: `${BASE_URL}/${slug}`,
      duration: DURATION,
      connections: Math.max(10, Math.floor(CONNECTIONS / SLUGS_TO_HIT.length)),
      pipelining: 1,
      requests: [
        {
          method: 'GET',
          path: `/${slug}`,
          headers: {
            'Accept': 'text/html',
            'User-Agent': 'autocannon-aux',
          },
        },
      ],
    }),
  );

  // Aguardar conclusão
  const [targetResult, ...auxResults] = await Promise.all([
    new Promise<autocannon.Result>((resolve) => {
      targetInstance.on('done', resolve);
    }),
    ...auxInstances.map(
      (instance) =>
        new Promise<autocannon.Result>((resolve) => {
          instance.on('done', resolve);
        }),
    ),
  ]);

  // Calcular totais dos auxiliares
  const auxTotalRequests = auxResults.reduce((sum, r) => sum + r.requests.total, 0);
  const auxTotalErrors = auxResults.reduce((sum, r) => sum + (r.errors || 0), 0);
  const auxTotalTimeouts = auxResults.reduce((sum, r) => sum + (r.timeouts || 0), 0);

  // ============================================================
  // Resultados
  // ============================================================

  console.log('');
  console.log('='.repeat(70));
  console.log('RESULTADO MULTI-SLUG');
  console.log('='.repeat(70));

  console.log('');
  console.log(`Slug alvo (/${TARGET_SLUG}):`);
  console.log(`Requests:     ${targetResult.requests.total.toLocaleString()}`);
  console.log(`Duração:      ${(targetResult.duration / 1000).toFixed(1)}s`);
  console.log(`Throughput:   ${(targetResult.throughput.total / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`Req/s:        ${targetResult.requests.average.toLocaleString()}`);
  console.log(`Latency p50:  ${targetResult.latency.p50}ms`);
  console.log(`Latency p75:  ${targetResult.latency.p75}ms`);
  console.log(`Latency p90:  ${targetResult.latency.p90}ms`);
  console.log(`Latency p99:  ${targetResult.latency.p99}ms`);
  console.log(`Latency max:  ${targetResult.latency.max}ms`);
  console.log(`Erros:        ${targetResult.errors || 0}`);
  console.log(`Timeouts:     ${targetResult.timeouts || 0}`);

  console.log('');
  console.log(`Slugs auxiliares (${SLUGS_TO_HIT.length} slugs):`);
  console.log(`Requests totais: ${auxTotalRequests.toLocaleString()}`);
  console.log(`Erros totais:    ${auxTotalErrors}`);
  console.log(`Timeouts totais: ${auxTotalTimeouts}`);

  console.log('');
  console.log(`Total geral:`);
  console.log(`Requests: ${(targetResult.requests.total + auxTotalRequests).toLocaleString()}`);
  console.log(`Req/s:    ${(targetResult.requests.average + auxResults.reduce((sum, r) => sum + r.requests.average, 0)).toLocaleString()}`);

  console.log('');
  console.log('='.repeat(70));

  // Avaliação
  const p99 = targetResult.latency.p99;
  const p90 = targetResult.latency.p90;
  const p50 = targetResult.latency.p50;

  if (p90 <= 50) {
    console.log(`p90 Latency Target (≤50ms): PASSED (${p90}ms)`);
  } else {
    console.log(`p90 Latency Target (≤50ms): FAILED (${p90}ms)`);
  }

  if (p99 <= 50) {
    console.log(`p99 Latency Target (≤50ms): PASSED (${p99}ms)`);
  } else {
    console.log(`p99 Latency Target (≤50ms): FAILED (${p99}ms)`);
  }

  console.log('');

  // Cleanup
  targetInstance.stop();
  auxInstances.forEach((i) => i.stop());
}

// ============================================================
// Executar
// ============================================================

runMultiSlugStressTest().catch(console.error);
