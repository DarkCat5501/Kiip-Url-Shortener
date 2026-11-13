import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { startApp } from './support.js';

describe('AppController (e2e)', () => {
  let app: Awaited<ReturnType<typeof startApp>>;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', async () => {
    const response = await fetch(`${app.url}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello World!');
  });
});
