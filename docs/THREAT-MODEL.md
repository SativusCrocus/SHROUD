# Threat model and release boundaries

Scope: a new, fixed-denomination ERC-20 privacy-pool development implementation. No original Nullmask source or deployed state was available. No mainnet deployment or audit has occurred.

## Assets and trust

The secrets `n` and `s` authorize a note. A wallet must generate them with a cryptographic RNG and keep an encrypted backup. The relayer receives only a proof and public withdrawal data. Node's SDK runs locally; a browser wallet, secure storage layer and reorg-aware indexer are not included.

The constructor fixes the asset, denomination, hasher, verifier, Aave pool, aToken, reserve ratio and treasury. No administrator can replace these or override proof verification. The treasury owner controls keeper selection. Constructor immutability prevents later configuration changes but also prevents repairing a bad deployment in place.

Aave's pool, aToken implementation, underlying asset and their governance remain external trust dependencies. The adapter can check ABI-level consistency; it cannot establish that an arbitrary address is a legitimate deployment. The treasury likewise depends on the selected Uniswap router and token pair. Use the original V3 router ABI, not Router02 or UniversalRouter.

## Adversaries and observations

| Adversary / failure | Implemented defense | Remaining exposure |
|---|---|---|
| Replayed withdrawal | Spent-nullifier set and EVM atomicity | A copied valid proof can execute first, with the same bound payout |
| Changed recipient, fee or relayer | Seven public signals bound by Groth16 and checked on-chain | Circuit/verifier soundness and setup assumptions |
| Cross-pool or cross-chain proof reuse | Address and chain domain in circuit and verifier inputs | A same-address deployment on a chain sharing the same chain ID needs separate domain planning |
| Reentrant token/protocol calls | Pool and vault reentrancy guards; spent mark before custody interaction | Unknown token semantics and protocol implementation bugs |
| Deposit transfer tax | Exact received-amount check | Rebasing, blacklisting, malicious balance reporting and tokens outside the supported assumptions |
| Lending illiquidity | Idle buffer; failed withdrawal rolls back state | No instant withdrawal once the buffer is insufficient |
| Lending impairment | Solvency checks freeze new deposits, harvest and withdrawal | Permanent loss can strand notes; no insurance, unwind or recovery path |
| Principal sent to treasury | Surplus ceiling, reserve-preserving harvest, post-transfer solvency check | Depends on faithful asset/aToken balance reporting |
| Bad swap output | Fixed token pair/router, deadline, measured output and minimum output | Compromised keeper, incorrect oracle choice, MEV within allowed slippage |
| Chain analysis | ZK membership hiding; no public commitment/nullifier link in the withdrawal interface | Amount, timing, relayer, fee, network metadata, ERC-20 transfers and anonymity-set size |
| Decoy classification | None claimed | Public zero-value CoverTraffic events are trivial to filter |
| Dependency compromise | Pinned package versions, package-lock integrity metadata, source visibility | Pinned vulnerable or compromised packages remain vulnerable |

## Accounting properties tested

With standard ERC-20 semantics and faithful external balances, deposit increases principal by the exact denomination; withdrawal decreases it by the same denomination. Recipient payout plus relayer fee equals that denomination. Harvest transfers no more than reported surplus and leaves reported backing at least equal to principal. A successful harvest also leaves the configured principal reserve liquid. Aave losses invalidate the solvency premise.

No process can provide unconditional instantaneous redemption while it lends all available principal to a market that can become illiquid. The reserve reduces exposure to that problem; it does not remove it. A relayer fee reduces the user's net receipt, and gas is a separate user or operator expense.

## Before a public deployment

1. Audit the circuit constraints, Poseidon domain construction, generated verifier, ABI, custody and treasury together. Prove value conservation against the final asset model. Tests do not establish these proofs.
2. Conduct and verify an independent multi-party setup. Publish reproducible circuit/compiler/key/verifier hashes and ceremony transcripts. The local setup's zkey consistency check is insufficient for this purpose.
3. Select a chain and asset. Validate canonical deployed addresses and proxies; test aToken rounding, caps, pauses, zero-LTV behavior, supply failures, unavailable liquidity and asset freezes on a pinned chain fork.
4. Define the insolvency and recovery policy. The current immutable vault deliberately contains no ad hoc seizure or upgrade path. A loss freezes withdrawals and may be permanent.
5. Validate real SHROUD liquidity and independent USD price feeds. The provided keeper has no L2 sequencer-uptime check. Add one with a grace period before deploying it on an L2, and establish feed freshness/price-deviation bounds for the actual market.
6. Complete encrypted note backup, reorg-aware event indexing and witness refresh. Index Deposit events by emitted leaf index, validate the reconstructed root against the chain, and account for the 100-root history window.
7. Test the network privacy model. Do not ship “Anti-AI” or anonymity guarantees based on the presence of cover events. Measure the real anonymity set and metadata leakage.
8. Resolve or assess the remaining transitive elliptic dependency advisory; establish dependency and operator-key maintenance processes.

These are implementation gaps for this project, not a certification checklist that implies approval once boxes are checked.
