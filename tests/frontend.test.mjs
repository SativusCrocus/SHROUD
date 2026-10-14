import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PoolSimulation } from '../frontend/simulation.js';

test('simulation rejects replay and illiquid redemption without changing state', () => {
  const model = new PoolSimulation();
  const before = JSON.stringify(model);
  assert.throws(() => model.withdraw(1, true), /liquidity/);
  assert.equal(JSON.stringify(model), before);
  model.withdraw(1);
  assert.equal(model.principal, 200);
  assert.equal(model.unspent.length, 2);
  const after = JSON.stringify(model);
  assert.throws(() => model.withdraw(1), /already been used/);
  assert.equal(JSON.stringify(model), after);
});

test('simulation harvest isolates surplus and preserves the principal reserve', () => {
  const model = new PoolSimulation();
  assert.throws(() => model.harvest(), /no surplus/);
  model.deposit();
  model.accrueYield();
  assert.equal(model.principal, 400);
  assert.equal(model.surplus, 10);
  const before = JSON.stringify(model);
  assert.throws(() => model.harvest(true), /liquidity/);
  assert.equal(JSON.stringify(model), before);
  assert.equal(model.harvest(), 10);
  assert.equal(model.idle, 80);
  assert.equal(model.supplied + model.idle, 400);
  assert.equal(model.treasury, 10);
});

test('empty simulation cannot withdraw or earn lending interest', () => {
  const model = new PoolSimulation();
  [1, 2, 3].forEach(id => model.withdraw(id));
  assert.equal(model.principal, 0);
  assert.equal(model.idle + model.supplied, 0);
  assert.throws(() => model.accrueYield(), /No assets/);
  assert.throws(() => model.withdraw(7), /Choose/);
  model.deposit();
  assert.equal(model.principal, 100);
  assert.equal(model.idle, 20);
});

test('public frontend assets and Vercel policy exclude secret-bearing protocol files', async () => {
  const files = await readdir(new URL('../dist/', import.meta.url));
  assert.deepEqual(files.sort(), ['404.html', 'app.js', 'index.html', 'mark.svg', 'robots.txt', 'simulation.js', 'styles.css']);
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  const policy = config.headers[0].headers.find(header => header.key === 'Content-Security-Policy').value;
  assert.ok(policy.includes("connect-src 'none'"));
  assert.ok(!policy.includes('unsafe-inline') && !policy.includes('unsafe-eval'));
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /SIMULATION/);
  assert.ok(!/\son\w+=/i.test(html));
});
