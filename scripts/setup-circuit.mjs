import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
await mkdir('build/circuit', { recursive: true });
await mkdir('contracts/generated', { recursive: true });
const run = (binary, args) => new Promise((resolve, reject) => {
  const child = spawn(path.join(root, 'node_modules', '.bin', binary), args, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${binary} failed (${code})`)));
});
console.log('LOCAL DEVELOPMENT SETUP ONLY. Do not deploy this verifier with real funds.');
await run('circom2', ['circuits/withdraw.circom', '--r1cs', '--wasm', '--sym', '-o', 'build/circuit']);
await run('snarkjs', ['powersoftau', 'new', 'bn128', '14', 'build/circuit/pot0.ptau']);
await run('snarkjs', ['powersoftau', 'contribute', 'build/circuit/pot0.ptau', 'build/circuit/pot1.ptau',
  '--name=CipherShroud local development', `--entropy=${randomBytes(64).toString('hex')}`]);
await run('snarkjs', ['powersoftau', 'prepare', 'phase2', 'build/circuit/pot1.ptau', 'build/circuit/pot-final.ptau']);
await run('snarkjs', ['groth16', 'setup', 'build/circuit/withdraw.r1cs', 'build/circuit/pot-final.ptau', 'build/circuit/withdraw0.zkey']);
await run('snarkjs', ['zkey', 'contribute', 'build/circuit/withdraw0.zkey', 'build/circuit/withdraw.zkey',
  '--name=CipherShroud local development', `--entropy=${randomBytes(64).toString('hex')}`]);
await run('snarkjs', ['zkey', 'verify', 'build/circuit/withdraw.r1cs', 'build/circuit/pot-final.ptau', 'build/circuit/withdraw.zkey']);
await run('snarkjs', ['zkey', 'export', 'verificationkey', 'build/circuit/withdraw.zkey', 'build/circuit/verification_key.json']);
await run('snarkjs', ['zkey', 'export', 'solidityverifier', 'build/circuit/withdraw.zkey', 'build/circuit/WithdrawalVerifier.sol']);
await rename('build/circuit/WithdrawalVerifier.sol', 'contracts/generated/WithdrawalVerifier.sol');
const files = ['circuits/withdraw.circom', 'build/circuit/withdraw.r1cs',
  'build/circuit/withdraw_js/withdraw.wasm', 'build/circuit/withdraw.zkey',
  'build/circuit/verification_key.json', 'contracts/generated/WithdrawalVerifier.sol'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile('build/circuit/manifest.json', JSON.stringify({ mode: 'local-development-only', hashes }, null, 2) + '\n');
console.log('Circuit, verifier, and development key ready. npm run build');
