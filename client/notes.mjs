import { randomBytes, randomInt } from 'node:crypto';
import { buildPoseidon } from 'circomlibjs';
import { groth16 } from 'snarkjs';

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 20;
const poseidon = await buildPoseidon();
export const hash = (a, b) => BigInt(poseidon.F.toString(poseidon([BigInt(a), BigInt(b)])));
const fieldRandom = () => {
  let value;
  do { value = BigInt(`0x${randomBytes(32).toString('hex')}`); } while (value === 0n || value >= FIELD);
  return value;
};

export function createNote(chainId, pool) {
  if (BigInt(chainId) <= 0n || BigInt(chainId) >= 2n ** 64n || BigInt(pool) <= 0n || BigInt(pool) >= 2n ** 160n) {
    throw new Error('Invalid note domain');
  }
  return { version: 1, chainId: String(chainId), pool, nullifier: String(fieldRandom()), secret: String(fieldRandom()) };
}

export function noteHashes(note) {
  const domain = hash(note.chainId, note.pool);
  return {
    commitment: hash(hash(note.nullifier, note.secret), domain),
    nullifierHash: hash(note.nullifier, domain),
  };
}

// Independent random padding. Never derive these records from note secrets or nullifiers.
export function createCoverRoutes() {
  const routes = new Set();
  const count = randomInt(2, 4);
  while (routes.size < count) {
    const route = randomBytes(32).toString('hex');
    if (!/^0+$/.test(route)) routes.add(`0x${route}`);
  }
  return [...routes];
}

export function merkleWitness(commitments, leafIndex) {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= commitments.length || commitments.length > 2 ** DEPTH) {
    throw new Error('Invalid leaf index or tree capacity');
  }
  let nodes = commitments.map(value => {
    const v = BigInt(value);
    if (v <= 0n || v >= FIELD) throw new Error('Invalid commitment');
    return v;
  });
  let zero = 0n;
  let index = leafIndex;
  const siblings = [], pathIndices = [];
  for (let level = 0; level < DEPTH; ++level) {
    siblings.push(String(nodes[index ^ 1] ?? zero));
    pathIndices.push(index % 2);
    const parents = [];
    for (let i = 0; i < nodes.length; i += 2) parents.push(hash(nodes[i], nodes[i + 1] ?? zero));
    nodes = parents;
    zero = hash(zero, zero);
    index = Math.floor(index / 2);
  }
  return { root: String(nodes[0]), siblings, pathIndices };
}

export async function proveWithdrawal({ note, commitments, leafIndex, recipient, relayer, fee = 0n, wasm, zkey }) {
  const { commitment, nullifierHash } = noteHashes(note);
  if (BigInt(commitments[leafIndex] ?? 0) !== commitment) throw new Error('Note does not match selected leaf');
  const witness = merkleWitness(commitments, leafIndex);
  const input = { ...witness, nullifierHash: String(nullifierHash), recipient: String(BigInt(recipient)),
    relayer: String(BigInt(relayer)), fee: String(fee), chainId: note.chainId, pool: String(BigInt(note.pool)),
    nullifier: note.nullifier, secret: note.secret };
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
  const [a, b, c, signals] = JSON.parse(`[${await groth16.exportSolidityCallData(proof, publicSignals)}]`);
  return { proof, publicSignals, withdrawal: {
    a, b, c, root: signals[0], nullifierHash: signals[1], recipient, relayer, fee,
  } };
}
