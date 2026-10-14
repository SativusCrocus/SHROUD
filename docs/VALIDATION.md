# Validation record

Validation date: October 13, 2026. This record describes local development tests, not an audit or a production certification.

## Environment

- Node.js 24.12.0 for the final client tests and end-to-end demo.
- Python 3.14.3 for migration tests.
- Foundry 1.5.1; Solidity 0.8.28; Cancun EVM target.
- Pinned circom2 0.2.23, circomlib 2.0.5, circomlibjs 0.1.7 and snarkjs 0.7.6.

## Executed checks

| Check | Result |
|---|---|
| Circuit compilation | Passed: 6,564 nonlinear + 6,581 linear constraints, 7 public inputs |
| Development Groth16 setup and `zkey verify` | Passed; single-machine setup only |
| Solidity compilation | Passed |
| Python migration tests | 8 passed |
| Node client and oracle-math tests | 6 passed |
| Frontend model and deployment-boundary tests | 4 passed |
| Solidity tests | 16 passed, including 256 fuzz cases in the yield/principal test |
| Local deployment and proof demo | Passed with real Poseidon, real Groth16 proof and real Solidity verifier |
| Keeper syntax and quote validation | Syntax checked; price scaling/staleness/invalid-data tests passed |

The local demo tested three deposits, client/on-chain root agreement, bounded cover-event counts, mock interest accrual, surplus harvest, treasury burn, verification of a real withdrawal proof, rejection of changes to all seven public inputs, invalid witnesses, payout substitution, actual reverting withdrawal state, successful liquidity retry, and replay rejection. The scripts stop the ephemeral chain and close proof-worker processes after completion. Expected circuit assertion errors appear during deliberately invalid witness tests; the demo treats them as successful negative checks.

The Solidity suite also covers reserve-preserving harvest, transfer-tax rejection, unavailable supply, partial redemption, loss detection, vault authorization, keeper authorization, independent minimum-output enforcement, root-history expiration and a malicious token's reentrancy attempt. Contract unit tests use mock verification to isolate state/accounting behavior. The demo separately exercises the generated cryptographic verifier.

Generated run evidence is available in `build/demo-results.json` in the delivered working directory. The source archive excludes generated build files; regenerate them with the README commands. `build/circuit/manifest.json` hashes the local circuit, R1CS, WASM, zkey, verification key and Solidity verifier. Hashes establish consistency of these local artifacts, not a trust guarantee.

## Dependency findings

After pinning patched transitive `ws` 8.22.0 and `underscore` 1.13.8 versions, `npm audit` reported **15 low-severity findings, zero moderate, high or critical findings**. Those 15 entries propagate the remaining elliptic advisory through the ethers 5 dependency bundled by circomlibjs. The application's signer uses ethers 6.17.0; circomlibjs's EVM hash-contract generator still imports ethers 5 utilities.

The upstream finding is [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84). No assessment here claims the affected dependency is safe. The version override approach preserves circomlibjs's expected ethers API instead of forcing an incompatible major upgrade. Resolve or independently assess the remaining cryptographic dependency before production use. The complete audit response is saved locally as `build/npm-audit.json`; results may change as advisories change.

## Not verified

- Aave or Uniswap against live contracts or a pinned mainnet fork.
- A deployed SHROUD market, independent SHROUD/USD oracle, or the keeper against live price feeds.
- L2 sequencer failure handling, asset freezes, adversarial rebasing or all aToken rounding conditions.
- Browser-wallet storage, encrypted note recovery, reorg-aware event indexing or relayer network privacy.
- Groth16 circuit soundness by independent audit, formal value-conservation proof, or a public trusted setup.
- Any anti-clustering, anti-AI or anonymity improvement from padding events.
- Guaranteed redemption during external loss or illiquidity.

The repository is a runnable development foundation. These unverified items prevent a production-ready claim.

## Frontend release checks

The frontend release adds four tests, bringing the suite to 34 tests: eight Python, ten Node and sixteen Solidity tests. The Solidity fuzz test still runs 256 cases. Frontend model tests cover replay rejection, state preservation under unavailable liquidity, reserve-preserving harvest and an empty pool. The build test checks the exact public-file list and the restrictive Vercel Content Security Policy.

Browser checks exercised deposit, blocked withdrawal, successful retry, replay rejection and surplus harvest. A mobile viewport showed no horizontal document overflow. The public frontend has no runtime dependencies, wallet connection, note storage or RPC calls; the remaining protocol dependency findings are not shipped as browser code.
