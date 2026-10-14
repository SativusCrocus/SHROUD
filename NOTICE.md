# Attribution

CipherShroud was created as a new development reference implementation. No source repository for the formerly named project was supplied, so no ownership or license claim is made over that absent codebase.

Dependencies retain their upstream licenses and attribution:

- OpenZeppelin Contracts 5.6.1: MIT, used for ERC-20, SafeERC20, ownership and reentrancy protection.
- circomlib 2.0.5, circomlibjs 0.1.7 and snarkjs 0.7.6: upstream package metadata identifies GPL-3.0; individual source files may carry additional or different notices, which remain authoritative for those files.
- circom2 0.2.23: compiler distributed through its upstream package; retain its license when redistributing it.
- ethers 6.17.0: MIT; circomlibjs also brings an older ethers version transitively.
- Foundry and Solidity are external build tools with their own licenses.

The generated verifier retains the license header emitted by snarkjs. Poseidon EVM bytecode is generated with circomlibjs. The source archive excludes dependency directories; npm installs the pinned sources and their notices.

Original Solidity files carry MIT SPDX identifiers and use LICENSE-MIT. Original JavaScript, Python, Circom and documentation in this distribution are offered under GPL-3.0-or-later; see LICENSE. Nothing here removes an upstream license obligation or grants rights to third-party trademarks.
