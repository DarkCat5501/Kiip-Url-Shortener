#!/usr/bin/env bun
/**
 * Stress test: dispare máximo de requests paralelas em um slug específico
 *
 * Uso:
 *   bun run hit-slug.ts <slug> [--duration 10] [--connections 200]
 *
 * Exemplo:
 *   bun run hit-slug.ts test-0001
 *   bun run hit-slug.ts test-0001 --duration 30 --connections 500
 */

import autocannon from 'autocannon';

const API = process.env.API_URL || 'http://localhost:3000';

// Parse args
const args = process.argv.slice(2);
const slug = args[0];

if (!slug) {
  console.error('Informe o slug. Ex: bun run hit-slug.ts test-0001');
  process.exit(1);
}

const durationIdx = args.indexOf('--duration');
const connectionsIdx = args.indexOf('--connections');

const duration = durationIdx !== -1 ? parseInt(args[durationIdx + 1]) : 10;
const connections = connectionsIdx !== -1 ? parseInt(args[connectionsIdx + 1]) : 200;

const url = `${API}/${slug}`;

console.log(`Stress test: GET ${url}`);
console.log(`Duração: ${duration}s | Conexões: ${connections}`);
console.log('');

// Verificar se a API está acessível
try {
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status === 302 || res.status === 404 || res.status === 410) {
    console.log(`API respondeu (${res.status})`);
  } else {
    console.log(`API respondeu com status ${res.status}`);
  }
} catch (err) {
  console.error(`API não acessível em ${API}`);
  process.exit(1);
}

console.log('');

const instance = autocannon({
  url,
  connections,
  duration,
  // HTTP pipelining (múltiplas requisições em voo na mesma conexão sem
  // aguardar resposta) infla artificialmente a latência medida — não reflete
  // como clientes HTTP reais se comportam (browsers não fazem pipelining).
  pipelining: 1,
  method: 'GET',
});

// Print progress
instance.on('tick', () => {
  process.stdout.write('.');
});

// Print result
instance.on('done', (result) => {
  console.log('\n');
  console.log('='.repeat(60));
  console.log(`RESULTADO: GET /${slug}`);
  console.log('='.repeat(60));
  console.log(`Requests:     ${result.requests.total.toLocaleString()}`);
  console.log(`Duração:      ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`Throughput:   ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`Req/s:        ${(result.requests.total / (result.duration / 1000)).toFixed(0)}`);
  console.log(`Latency p50:  ${result.latency.p50}ms`);
  console.log(`Latency p99:  ${result.latency.p99}ms`);
  console.log(`Latency max:  ${result.latency.max}ms`);
  console.log(`Erros:        ${result.errors}`);
  console.log(`Timeouts:     ${result.timeouts}`);
  console.log('='.repeat(60));

  // Target check
  const p99 = result.latency.p99;
  if (p99 <= 50) {
    console.log(`\np99 Latency Target (≤50ms): PASSED (${p99}ms)`);
  } else {
    console.log(`\np99 Latency Target (≤50ms): FAILED (${p99}ms)`);
  }

  process.exit(0);
});

// Graceful shutdown
process.once('SIGINT', () => {
  instance.stop();
});
