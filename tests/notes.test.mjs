import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverRoutes, createNote, noteHashes, merkleWitness, hash, DEPTH } from '../client/notes.mjs';

test('padding is bounded, unique, and independent across batches', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const routes = createCoverRoutes();
    assert.ok(routes.length >= 2 && routes.length <= 3);
    for (const route of routes) {
      assert.match(route, /^0x[0-9a-f]{64}$/);
      assert.ok(!seen.has(route));
      seen.add(route);
    }
  }
});

test('note domain separates pools and chains', () => {
  const note = createNote(31337, '0x0000000000000000000000000000000000000001');
  const original = noteHashes(note);
  for (const changed of [{ ...note, chainId: '1' }, { ...note, pool: '0x0000000000000000000000000000000000000002' }]) {
    assert.notEqual(noteHashes(changed).commitment, original.commitment);
    assert.notEqual(noteHashes(changed).nullifierHash, original.nullifierHash);
  }
});

test('witnesses for an odd-size tree share a root and reconstruct each leaf', () => {
  const leaves = [1n, 2n, 3n, 4n, 5n];
  const roots = new Set();
  for (let i = 0; i < leaves.length; i++) {
    const witness = merkleWitness(leaves, i);
    let node = leaves[i];
    for (let level = 0; level < DEPTH; level++) {
      node = witness.pathIndices[level] ? hash(witness.siblings[level], node) : hash(node, witness.siblings[level]);
    }
    assert.equal(String(node), witness.root);
    roots.add(witness.root);
  }
  assert.equal(roots.size, 1);
});
