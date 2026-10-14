# CipherShroud · SHROUD

**Zero-Knowledge Anti-AI Privacy Middleware Protocol**

CipherShroud is an EVM development implementation of fixed-denomination shielded withdrawals, experimental cover traffic, and segregated yield accounting. You can generate a Groth16 proof on your machine, verify it in Solidity, withdraw a note once, and exercise a buyback-and-burn treasury on a local chain.

**Development status:** no production deployment, external audit, public trusted-setup ceremony, or measured resistance to chain analysis. The “Anti-AI” wording names a research objective. The included padding events are distinguishable and provide no demonstrated protection against Chainalysis, Arkham, or other observers. Lending liquidity and solvency limit withdrawals.

This repository starts from scratch. No Nullmask repository, deployed contract, historical state, or original circuit was supplied. It contains no migration of existing user funds. The Python migration tool is available for a future source repository.

## What runs today

| Phase | Delivered implementation | Boundary |
|---|---|---|
| Rebranding | Python migration tool, case mapping, path renames, redacted reports, backups and restore | Unknown ownership of an address or URL requires an explicit manifest entry |
| Cover traffic and ZK | Circom membership circuit, generated Groth16 verifier, Poseidon tree, client notes, nullifier checks, 2–3 padding records per successful deposit/withdrawal | Padding records are public events, not indistinguishable money transfers |
| Yield and treasury | Aave V3 custody adapter, principal liabilities, idle reserve, surplus harvest, Uniswap V3 buyback and actual ERC-20 supply burn | Local tests use lending/swap mocks; no live Aave/Uniswap fork validation |
| Operations | Local deployment demo, keeper runner with oracle-derived minimum output, contract/client/migration tests | Live operation needs reviewed addresses, price feeds, deployment artifacts and funded operators |

The design uses an ERC-20 asset on an EVM chain. It does not implement Solana programs or Kamino integration. Node runs the client and keeper; Python runs the migration tool; the Rust-based Foundry tools compile and test Solidity.

## Architecture

```text
 User wallet / local note store
       |
       +-- approve vault, deposit fixed denomination ---------------------+
       |                                                                  |
       +-- local Circom witness + Groth16 proof                             v
                |                                            CipherShroudPool
                | public proof, root, nullifier, payout        |      |
                v                                             |      +--> Poseidon Merkle tree
       Relayer operator                                       |           + root history
       + independent random padding                           +---------> Groth16 verifier
                |                                             |           + spent-nullifier set
                +---------------------------------------------+
                                                              |
                                                     PrincipalVault
                                                     |            |
                                              idle reserve   Aave V3 supply
                                                     |            |
                                                     +------------+
                                                              |
                                           exact denomination payout
                                           (recipient + agreed relayer fee)

 Separate keeper process: investIdle / harvest / buyback
                               |
                    realized surplus only
                               v
                       BuybackTreasury <--- independent asset/USD + SHROUD/USD feeds
                               |
                     fixed Uniswap V3 route
                               |
                      acquire SHROUD -> burn()

 CoverTraffic events accompany user operations. They never enter the note tree.
```

## 1. Repository cleansing and renaming

The script uses Python's standard library. Run it from the source repository root, or supply `--root`. The first command makes no edits:

```bash
python3 /path/to/SHROUD/scripts/rebrand.py --root .
python3 /path/to/SHROUD/scripts/rebrand.py --root . --apply
```

For a portable checkout, copy `scripts/rebrand.py` into the target repository and use:

```bash
python3 scripts/rebrand.py --root .
python3 scripts/rebrand.py --root . --manifest rebrand.manifest.json --ticker-mode all
python3 scripts/rebrand.py --root . --manifest rebrand.manifest.json --ticker-mode all --apply
```

Copy `rebrand.manifest.example.json` to `rebrand.manifest.json` first. Add exact strings you own to `replacements`, their replacement placeholders as values, and legacy service domains to `legacy_hosts`. Use `protected_paths` for immutable fixtures or upstream code. Review the dry-run output before applying it. An address alone does not identify its owner: indiscriminate address replacement can destroy verifier constants, token addresses, deployed program IDs, and test vectors.

| Before | After |
|---|---|
| `Nullmask`, `NullMask` | `CipherShroud` |
| `nullMask` | `cipherShroud` |
| `nullmask` | `ciphershroud` |
| `NULLMASK` | `CIPHERSHROUD` |
| `null_mask`, `NULL_MASK` | `cipher_shroud`, `CIPHER_SHROUD` |
| `null-mask`, `NULL-MASK` | `cipher-shroud`, `CIPHER-SHROUD` |
| `MASK`, `MASK_PRICE` | `SHROUD`, `SHROUD_PRICE` |
| `Mask`, `mask`, `maskPrice` with `--ticker-mode all` | `Shroud`, `shroud`, `shroudPrice` |

The default ticker mode preserves lowercase generic `mask` identifiers. The `all` mode includes them and can change CSS properties or unrelated code, so inspect its changes. The tool preserves longer generic words such as `bitmask`, `unmask`, and `masked`. It does not perform AST-aware symbol resolution.

The tool replaces developer-wallet assignments it recognizes with `PLACEHOLDER_DEV_WALLET`; configured RPC/API literals with `YOUR_NEW_EVM_RPC_URL`, `YOUR_NEW_SOLANA_RPC_URL`, or `YOUR_NEW_API_BASE_URL`; and recognized legacy project/social URLs with placeholders. It reports remaining address-like tokens by file and count without printing their values. Supply a manifest for unlabeled wallets, unrelated legacy hostnames, shortened links, encoded strings, and routes that lack recognizable configuration keys. Replace placeholders with valid configuration before compiling a migrated repository; a bare Solidity address placeholder deliberately requires an edit.

The tool processes UTF-8 and BOM-marked UTF-16 text, preserves line endings and file modes, skips binary contents and dependency/build directories, preserves copyright/SPDX lines and legal files, and rejects destination collisions. It refuses symlinks and hard links for manual review. It renames nested files/directories from the deepest path upward. Add `--rename-root` to rename the repository directory itself; restore also reverses that move. Git history stays unchanged; Git remotes and existing deployments require separate migration.

After `--apply`, the JSON output contains an external backup path. Restore with:

```bash
python3 scripts/rebrand.py --restore /absolute/path/from/the/backup/field
```

Restore verifies changed-file hashes and refuses to overwrite subsequent edits. A caught migration failure rolls back completed writes and moves. A power failure or forced process kill may require manual recovery from the numbered original-file backups and journal. Backups contain original configuration values: protect and retire them under your existing secret-handling process. Rebranding does not rotate credentials or erase Git history.

## 2. Anti-AI Heuristic Poisoning: experimental cover traffic

`client/notes.mjs` generates either two or three independent, nonzero 256-bit route identifiers with Node's cryptographic RNG. The pool requires that count, rejects duplicates, and emits one zero-value `CoverTraffic` record per identifier after a successful user operation. A failed deposit or withdrawal emits no surviving cover events because the EVM reverts the transaction.

No padding record authorizes spending, changes the commitment tree, consumes a nullifier, calls an arbitrary destination, or transfers an asset. Relayers receive the public withdrawal and its proof. They do not receive note secrets or Merkle witnesses.

These records cannot honestly claim to “poison” an observer's model. An observer can remove zero-value events and inspect ERC-20 transfers, gas funding, timing, the caller, relayer identity, and withdrawal addresses. Attaching cover records to a real transaction exposes their grouping. Random values provide no mathematical indistinguishability from valid transfers.

Research on stronger cover traffic would need separately funded, valid transactions, a specified observer model, traffic scheduling, privacy measurements, and analysis of network metadata. This repository contains no claim that a fixed number of decoys defeats a named analysis company. Real privacy depends on proof security and the effective anonymity set; a one-user pool provides no meaningful anonymity.

## 3. Client-side ZK-nullifiers

Let `H` be the circomlib Poseidon hash with two inputs over the BN254 scalar field. The wallet samples independent nonzero field elements `n` and `s` with rejection sampling and computes:

```text
domain        = H(chainId, poolAddress)
commitment    = H(H(n, s), domain)
nullifierHash = H(n, domain)
```

The wallet stores `n` and `s` privately. It deposits a commitment for one fixed denomination. The pool inserts that commitment into a depth-20 incremental Merkle tree with at most 1,048,576 leaves. It retains 100 recent roots; deposits eventually expire older roots. A wallet can refresh its witness against a current root without changing its note or nullifier.

The circuit proves knowledge of `n`, `s`, and a valid Merkle path. It constrains each path index to a bit, derives the commitment and nullifier in the pool's domain, reconstructs the root, and range-constrains the public payout fields. The public-input order is:

```text
[root, nullifierHash, recipient, relayer, fee, chainId, poolAddress]
```

The pool supplies its own address and the current chain ID to the verifier. It rejects unknown roots, out-of-field commitments/nullifiers, duplicate deposits, spent nullifiers, invalid recipients, and a fee greater than or equal to the denomination. It marks the nullifier before external custody calls; a failed transfer or lending withdrawal reverts that mark and the liability reduction. Anyone can submit a valid proof, but the proof binds the recipient, relayer address and fee. Copying a proof can race its execution without redirecting the payout.

The recipient receives `denomination - fee`, and the bound relayer receives `fee`. Use zero fee to receive the exact deposit denomination. Transaction gas is separate. A depositor who submits an arbitrary commitment without retaining its opening can lose access to the deposit. The SDK rejects a note that does not match the selected leaf.

This circuit is a new fixed-denomination membership design. It does not reproduce Zcash's transaction format, multi-asset accounting, encrypted memos, note discovery, variable-value UTXOs, range-proof system, or consensus rules. Zcash's note commitments and nullifiers provide background for the terminology, not an inherited security proof. See the [Zcash protocol specification](https://zips.z.cash/protocol/protocol.pdf).

`npm run circuit:setup` compiles the circuit and creates a **single-machine development ceremony**. It verifies the generated zkey, exports the Solidity verifier, and hashes related artifacts into a manifest. Successful verification confirms artifact consistency; it does not prove the circuit's specification or establish trustworthy destruction of setup secrets. Production needs a reviewed circuit and independently verified ceremony. Regenerating keys changes the verifier and invalidates old artifact combinations. The setup follows the tooling described by [snarkjs](https://github.com/iden3/snarkjs); circuit constraints use the [Circom signal model](https://docs.circom.io/circom-language/signals/).

## 4. Yield-bearing shielded pools

`PrincipalVault` keeps three quantities separate:

```text
P = outstanding principal liabilities
I = idle underlying ERC-20 balance
A = nominal underlying balance represented by the vault's Aave aTokens
surplus = max(I + A - P, 0)
```

A successful deposit increases `P` by the exact amount received. The vault rejects transfer-tax deposits. `investIdle()` supplies idle assets above `ceil(P × reserveBps / 10,000)` to the configured Aave V3 pool. The adapter validates the aToken's underlying asset and pool references during construction. It grants exact allowances for supply and clears them afterward. It exposes no borrow, leverage, collateral-transfer, strategy-replacement, or administrator withdrawal function.

On withdrawal, the vault spends idle assets first and requests any shortfall from Aave. It verifies the amount returned, decreases `P` by the denomination, and checks exact recipient/relayer token balance increases. A failed transaction restores the original note-spent state and accounting. Deposits and withdrawals do not depend on successful investment, harvest, or buyback transactions.

`harvest(maxAmount)` sends at most the current surplus to the immutable treasury. Before paying, it attempts to restore enough liquidity to cover both the harvest and the configured principal reserve. It checks principal backing afterward. This prevents successful harvests from consuming the configured reserve. The reserve target limits investment; it cannot guarantee every withdrawal during external illiquidity.

**An accounting invariant is not an insurance fund.** Aave allows withdrawals only when the reserve has sufficient available liquidity. A pause, exploit, asset freeze, depeg, lending loss, or token incompatibility can prevent withdrawal. The vault rejects new deposits, harvesting and withdrawals when reported total assets fall below principal; it contains no loss-socialization or recovery mechanism. A frozen withdrawal remains retryable if liquidity returns, but recovery from a permanent loss needs a separate design. [Aave's withdrawal documentation](https://aave.com/help/supplying/withdraw-tokens) describes the liquidity restriction; the adapter uses the documented V3 [`supply` and `withdraw` interfaces](https://aave.com/docs/aave-v3/smart-contracts/pool).

The demo uses a 20% reserve. A 100% reserve avoids investing principal, while sacrificing principal-funded lending yield. Neither setting guarantees immunity to token or contract failures. Use standard, non-rebasing ERC-20 assets only; live token behavior and aToken rounding need chain-specific validation.

### Treasury and buybacks

`BuybackTreasury` has an immutable input asset, SHROUD token, router and fee tier. An authorized keeper submits an amount, nonzero minimum output, and deadline at most five minutes ahead. The contract uses the original Uniswap V3 `ISwapRouter.exactInputSingle` ABI, measures received SHROUD independently of the router return value, clears the spending allowance, and calls `burn()` on the acquired tokens. A burn reduces `totalSupply`; it does not merely transfer tokens to a dead address. Swap behavior and minimum-output policy follow the [Uniswap V3 single-swap interface](https://developers.uniswap.org/docs/protocols/v3/guides/swapping/single-hop-swapping).

The owner can replace the keeper through `setKeeper`; ownership transfers require two steps. The treasury has no access to principal in the vault. A compromised keeper can still choose a poor price for treasury assets. The contract enforces the submitted minimum but does not independently validate an oracle price. It includes no rescue function for accidentally sent assets.

`ShroudToken` mints the constructor-specified supply once and exposes standard burns. The demo's one-million-token supply is a test parameter, not a published token allocation or economic policy. The code promises no price appreciation or yield rate.

## Install, build, and deploy locally

### Frontend

The `frontend/` directory contains a dependency-free informational site and an off-chain accounting simulation. It has no wallet connection, hosted prover, private note storage, RPC calls, or live deposit functionality. The simulation is explicitly labeled and cannot move funds.

```bash
git clone https://github.com/SativusCrocus/SHROUD.git
cd SHROUD
npm run dev:frontend
```

Open `http://127.0.0.1:4173`. Node and Python suffice for this preview; the frontend does not need `npm install`. To build or test only the frontend:

```bash
npm run build:frontend
npm run test:frontend
```

Vercel uses `vercel.json` to build only seven explicitly allowlisted static files into `dist/`. Its install command does not install the protocol's npm dependencies. A strict Content Security Policy permits same-origin scripts/styles and blocks network connections, inline scripts, framing and form submission. See [deployment instructions](docs/DEPLOYMENT.md) for publication and operational boundaries.

### Protocol and real-proof local demo

Use Node.js 22+ (tested with Node 24.12.0), Python 3.10+ and Foundry. Dependencies are pinned in `package-lock.json`. Solidity is pinned to 0.8.28 and the Cancun EVM target.

If you already have Foundry, skip its installer. Otherwise, follow the [official installation guide](https://getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
foundryup
```

Clone the source repository:

```bash
git clone https://github.com/SativusCrocus/SHROUD.git
cd SHROUD
node --version
python3 --version
forge --version
anvil --version
npm ci --ignore-scripts
npm run circuit:setup
npm run build
npm test
npm run demo
```

`circuit:setup` can take several minutes. It requires no downloaded trusted-setup file. It writes the development zkey, WASM, verification key and manifest under `build/circuit/`, plus `contracts/generated/WithdrawalVerifier.sol`. Dependencies and generated artifacts stay out of source control. Run the development setup in each fresh checkout before running the real proof demo.

The demo starts its own loopback-only Anvil node on an available port, funds a freshly generated test wallet, deploys a real Poseidon hasher and Groth16 verifier, and deploys mock asset/lending/swap contracts. It deposits three notes, simulates yield, harvests and burns SHROUD, produces a real withdrawal proof, checks input tampering, exercises an illiquid withdrawal and successful retry, and rejects replay. It writes `build/demo-results.json`, terminates proof workers, and stops the ephemeral chain. No note secrets or signing keys are persisted in the result file.

`npm test` runs Python migration tests, Node client/keeper-math tests and Solidity tests. Unit contract tests use conspicuously named mock verifiers/hashers; `npm run demo` tests the real generated verifier and Poseidon implementation. Neither command audits the protocol or tests a live lending market.

There is no mainnet deployment command in this release. A production rollout still needs a selected chain/asset, reviewed deployed dependencies and token behavior, a public setup, reproducible audited artifacts, reserve/loss policy, funded keepers, real SHROUD liquidity and independent price feeds. Adding arbitrary production addresses to this development demo would not supply those guarantees.

## Run the maintenance keeper

The keeper is an ordinary long-running Node process. A supervisor must restart it after crashes and monitor failed transactions. It submits investment, harvest and buyback as separate transactions so a failed trade cannot revert a user's withdrawal.

```bash
cp .env.example .env
# Edit the addresses, chain ID, dedicated keeper key, price feeds, and buyback limit.
npm run keeper
```

The keeper validates the chain, vault/treasury/asset linkage and keeper authorization. Both oracle feeds must quote **USD**, one for the deposit asset and one for SHROUD, using the `AggregatorV3Interface` ABI. The script checks positive prices, update timestamps, decimal scaling and a configured maximum age, then derives a minimum output after bounded slippage. See the [Chainlink feed API](https://docs.chain.link/data-feeds/api-reference) for those fields. The operator must verify feed identity, heartbeat, market coverage and trust assumptions; interface compatibility does not establish feed quality.

No SHROUD/USD feed exists as part of this repository. Until you deploy or select a suitable independent price source, automated real-market buybacks remain unconfigured. L2 deployments also require sequencer-uptime and grace-period handling before enabling this runner there. Never use a freshly manipulated pool spot price as the sole price source. `MAX_BUYBACK_BASE_UNITS` limits each buyback, while `MAX_ORACLE_AGE_SECONDS` and `SLIPPAGE_BPS` set quote bounds. The treasury owner must authorize the runner's address using `setKeeper`.

The `.env.example` has intentional placeholders and cannot submit transactions as shipped. Keep the operator key outside source control; the script's failure logs do not print RPC URLs, keys, transaction payloads or note material.

## Files and integration boundaries

```text
circuits/withdraw.circom           Merkle membership, nullifier, payout/domain constraints
client/notes.mjs                   Private note generation, tree witnesses, Groth16 proving
contracts/CipherShroudPool.sol     Fixed deposits, root history, proof checks and spent set
contracts/PrincipalVault.sol       Principal accounting and Aave V3 custody
contracts/BuybackTreasury.sol      Keeper-restricted fixed-route swap and burn
contracts/ShroudToken.sol          Constructor supply and ERC-20 burns
contracts/interfaces/External.sol  Narrow external ABIs
relayer/submit.mjs                 Proof forwarding and maintenance helpers
scripts/rebrand.py                 Dry-run/apply/restore migration utility
scripts/setup-circuit.mjs          Development setup and artifact manifest
scripts/local-demo.mjs             Executable isolated local deployment and proof test
scripts/keeper.mjs                 Maintenance loop and oracle checks
tests/                            Python and Node tests
test/                             Solidity tests and test-only mocks
docs/THREAT-MODEL.md               Trust assumptions, failure modes, release gaps
docs/VALIDATION.md                 Verification results and dependency findings
```

Wallet integration still needs encrypted note backup, event indexing with reorg handling, witness refresh, transaction-state recovery, authenticated relayer transport, and a user interface. The SDK has no hosted note service. Losing a note's secrets can make the deposit unspendable. Never send secrets to the relayer or an RPC endpoint.

## Attribution and licensing

Original Solidity files use their stated MIT SPDX identifiers. The repository's JavaScript/circuit distribution uses GPL-3.0-or-later; third-party sources retain their licenses and copyright notices. See `LICENSE`, `LICENSE-MIT`, and `NOTICE.md`. Rebranding does not remove upstream attribution. OpenZeppelin supplies the ERC-20 utilities and reentrancy guard used here; see its [ERC-20 API](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) and [utility API](https://docs.openzeppelin.com/contracts/5.x/api/utils).
