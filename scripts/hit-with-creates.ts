#!/usr/bin/env bun
/**
 * Stress test: Redirect em 1 slug + criação massiva de links simultânea
 *
 * Uso:
 *   bun run hit-with-creates.ts <slug> [duration] [create-rate]
 *
 * Exemplo:
 *   bun run hit-with-creates.ts MxCMMF6 15 50000
 */

import autocannon from 'autocannon';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TARGET_SLUG = process.argv[2] || 'MxCMMF6';
const DURATION = parseInt(process.argv[3] || '10');
const CREATE_RATE = parseInt(process.argv[4] || '500'); // links por segundo

interface CreateResult {
  slug: string;
  success: boolean;
  status?: number;
}

console.log(`Stress Test: Redirect + Criação Massiva`);
console.log(`  API: ${API_URL}`);
console.log(`  Slug alvo: ${TARGET_SLUG}`);
console.log(`  Duração: ${DURATION}s`);
console.log(`  Taxa de criação: ${CREATE_RATE} links/s`);
console.log();

// Verificar se API está disponível
try {
  const check = await fetch(`${API_URL}/${TARGET_SLUG}`, { redirect: 'manual' });
  if (check.status === 302 || check.status === 301) {
    console.log(`API disponível (slug ${TARGET_SLUG} redireciona)`);
  } else {
    console.log(`Slug ${TARGET_SLUG} retornou ${check.status}`);
  }
} catch (e) {
  console.error(`API indisponível em ${API_URL}`);
  process.exit(1);
}

// ============================================
// Gerador de links em background
// ============================================
let totalCreated = 0;
let totalCreateErrors = 0;
let creating = true;

async function createLink(index: number): Promise<CreateResult> {
  try {
    const res = await fetch(`${API_URL}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://example.com/create-test-${index}` }),
    });
    if (res.ok) {
      totalCreated++;
      const body = await res.json();
      return { slug: body.slug, success: true, status: res.status };
    } else {
      totalCreateErrors++;
      return { slug: '', success: false, status: res.status };
    }
  } catch {
    totalCreateErrors++;
    return { slug: '', success: false };
  }
}

// Loop de criação — tenta manter a taxa desejada por segundo
async function creationLoop() {
  let index = 0;

  while (creating) {
    // Disparar batch grande de criação (fire and forget)
    const batchSize = Math.min(CREATE_RATE, 500); // batches de até 500
    const promises: Promise<CreateResult>[] = [];

    for (let i = 0; i < batchSize && creating; i++) {
      promises.push(createLink(index++));
    }

    // Não aguardar — fire and forget
    promises.forEach(p => p.catch(() => {}));

    // Pequena pausa para não travar o event loop
    await Bun.sleep(1);
  }
}

// Status em tempo real
const statusInterval = setInterval(() => {
  process.stdout.write(`\r    Links criados: ${totalCreated} | Erros: ${totalCreateErrors}`);
}, 1000);

// ============================================
// Iniciar criação em background
// ============================================
console.log(`Iniciando criação de links (${CREATE_RATE}/s)...`);
const creationPromise = creationLoop();

// ============================================
// Iniciar stress test de redirect
// ============================================
console.log(`Iniciando stress test no slug ${TARGET_SLUG}...`);
console.log();

const instance = autocannon({
  url: `${API_URL}/${TARGET_SLUG}`,
  duration: DURATION,
  connections: 50,
  // HTTP pipelining infla artificialmente a latência medida (não reflete
  // clientes HTTP reais)
  pipelining: 1,
}, (err, result) => {
  if (err) {
    console.error('Erro no stress test:', err);
    return;
  }

  creating = false;
  clearInterval(statusInterval);

  // Aguardar um pouco para contagens finais
  setTimeout(() => {
    console.log('\n');
    console.log('='.repeat(70));
    console.log('RESULTADO: REDIRECT + CRIAÇÃO MASSIVA');
    console.log('='.repeat(70));
    console.log();
    console.log(`Slug alvo (/${TARGET_SLUG}):`);
    console.log(`Requests:     ${result.requests.total.toLocaleString()}`);
    console.log(`Req/s:        ${(result.requests.total / DURATION).toFixed(0)}`);
    console.log(`Latency p50:  ${result.latency.p50}ms`);
    console.log(`Latency p90:  ${result.latency.p90}ms`);
    console.log(`Latency p99:  ${result.latency.p99}ms`);
    console.log(`Latency max:  ${result.latency.max}ms`);
    console.log(`Errors:       ${result.errors}`);
    console.log(`Timeouts:     ${result.timeouts}`);
    console.log();
    console.log(`Criação de links (durante o teste):`);
    console.log(`Links criados: ${totalCreated.toLocaleString()}`);
    console.log(`Erros:         ${totalCreateErrors.toLocaleString()}`);
    console.log(`Taxa real:     ${(totalCreated / DURATION).toFixed(0)} links/s`);
    console.log();

    const p99 = result.latency.p99;
    if (p99 <= 50) {
      console.log(`p99 Latency Target (≤50ms): PASSED (${p99}ms)`);
    } else {
      console.log(`p99 Latency Target (≤50ms): FAILED (${p99}ms)`);
    }
    console.log();
    process.exit(0);
  }, 500);
});
