/**
 * Setup script - Creates test data for stress testing
 * Run: bun run setup.ts [count]
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const COUNT = parseInt(process.argv[2] || '100');

async function createLink(url: string) {
  const res = await fetch(`${API_URL}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create link: ${res.status} - ${error}`);
  }

  return res.json();
}

async function accessLink(slug: string) {
  const res = await fetch(`${API_URL}/${slug}`, {
    redirect: 'manual',
  });
  return res.status;
}

async function main() {
  console.log(`Creating ${COUNT} test links...`);

  const slugs: string[] = [];
  const batchSize = 10;

  for (let i = 0; i < COUNT; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, COUNT); j++) {
      const url = `https://example.com/page-${j}`;
      batch.push(createLink(url));
    }

    const results = await Promise.allSettled(batch);
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        slugs.push(result.value.slug);
        process.stdout.write('.');
      } else {
        process.stdout.write('x');
        console.error(`\nError: ${result.reason}`);
      }
    });
  }

  console.log(`\nCreated ${slugs.length} links`);

  // Access each link a few times to generate stats
  console.log(`Generating access stats...`);
  const accessCount = Math.min(slugs.length * 3, 500);

  for (let i = 0; i < accessCount; i++) {
    const slug = slugs[Math.floor(Math.random() * slugs.length)];
    await accessLink(slug);
    if (i % 50 === 0) process.stdout.write('.');
  }

  console.log(`\nGenerated ${accessCount} accesses`);

  // Print some popular links for testing
  console.log(`\nSample slugs for testing:`);
  for (let i = 0; i < 5; i++) {
    const idx = Math.floor(Math.random() * slugs.length);
    console.log(`  ${slugs[idx]}`);
  }

  console.log(`\nSetup complete! Ready for stress testing.`);
}

main().catch(console.error);