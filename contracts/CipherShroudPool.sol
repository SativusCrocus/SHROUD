// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoseidon, IWithdrawalVerifier, IAavePool, IAToken} from "./interfaces/External.sol";
import {PrincipalVault} from "./PrincipalVault.sol";

/// @notice Development fixed-denomination pool. No administrative proof or withdrawal bypass.
contract CipherShroudPool is ReentrancyGuard {
    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant DEPTH = 20;
    uint32 public constant ROOT_HISTORY = 100;
    IPoseidon public immutable hasher;
    IWithdrawalVerifier public immutable verifier;
    PrincipalVault public immutable vault;
    uint256 public immutable denomination;
    uint32 public nextIndex;
    uint32 public rootCursor;
    uint256[20] public zeros;
    uint256[20] public filledSubtrees;
    uint256[100] public roots;
    mapping(uint256 => bool) public commitments;
    mapping(uint256 => bool) public spent;

    struct Withdrawal {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256 root;
        uint256 nullifierHash;
        address recipient;
        address relayer;
        uint256 fee;
    }

    error InvalidConfiguration();
    error InvalidCommitment();
    error InvalidWithdrawal();
    error InvalidProof();
    error InvalidCoverCount();
    event Deposit(uint256 indexed commitment, uint32 index, uint256 root);
    event WithdrawalExecuted(uint256 indexed nullifierHash, address indexed recipient, address relayer, uint256 fee);
    // These are observable padding records; they do not hide real transfers or create spendable notes.
    event CoverTraffic(bytes32 route, uint256 dummyValue);

    constructor(
        IERC20 asset, uint256 denomination_, IPoseidon hasher_, IWithdrawalVerifier verifier_,
        IAavePool lendingPool, IAToken aToken, address treasury, uint256 reserveBps
    ) {
        if (denomination_ == 0 || denomination_ >= 2 ** 128 || block.chainid >= 2 ** 64
            || address(hasher_).code.length == 0 || address(verifier_).code.length == 0) {
            revert InvalidConfiguration();
        }
        denomination = denomination_;
        hasher = hasher_;
        verifier = verifier_;
        vault = new PrincipalVault(asset, lendingPool, aToken, treasury, reserveBps);
        uint256 current;
        for (uint32 level; level < DEPTH; ++level) {
            zeros[level] = current;
            filledSubtrees[level] = current;
            current = _hash(current, current);
        }
        roots[0] = current;
    }

    function latestRoot() external view returns (uint256) { return roots[rootCursor]; }

    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0 || root >= FIELD) return false;
        for (uint32 i; i < ROOT_HISTORY; ++i) if (roots[i] == root) return true;
        return false;
    }

    // User approves vault, not pool. Any failed custody operation rolls back the Merkle insertion.
    function deposit(uint256 commitment, bytes32[] calldata coverRoutes) external nonReentrant {
        _validateCover(coverRoutes);
        if (commitment == 0 || commitment >= FIELD || commitments[commitment] || nextIndex >= 2 ** DEPTH) {
            revert InvalidCommitment();
        }
        commitments[commitment] = true;
        uint32 leafIndex = nextIndex++;
        uint32 index = leafIndex;
        uint256 current = commitment;
        for (uint32 level; level < DEPTH; ++level) {
            if (index % 2 == 0) {
                filledSubtrees[level] = current;
                current = _hash(current, zeros[level]);
            } else {
                current = _hash(filledSubtrees[level], current);
            }
            index /= 2;
        }
        rootCursor = (rootCursor + 1) % ROOT_HISTORY;
        roots[rootCursor] = current;
        vault.depositFrom(msg.sender, denomination);
        emit Deposit(commitment, leafIndex, current);
        _emitCover(coverRoutes);
    }

    function withdraw(Withdrawal calldata w, bytes32[] calldata coverRoutes) external nonReentrant {
        _validateCover(coverRoutes);
        if (!isKnownRoot(w.root) || w.nullifierHash == 0 || w.nullifierHash >= FIELD || spent[w.nullifierHash]
            || w.recipient == address(0) || w.recipient == address(vault) || w.fee >= denomination
            || (w.fee != 0 && (w.relayer == address(0) || w.relayer == address(vault)))) {
            revert InvalidWithdrawal();
        }
        uint256[7] memory signals = [w.root, w.nullifierHash, uint256(uint160(w.recipient)),
            uint256(uint160(w.relayer)), w.fee, block.chainid, uint256(uint160(address(this)))];
        if (!verifier.verifyProof(w.a, w.b, w.c, signals)) revert InvalidProof();
        spent[w.nullifierHash] = true;
        vault.withdrawTo(w.recipient, w.relayer, denomination, w.fee);
        emit WithdrawalExecuted(w.nullifierHash, w.recipient, w.relayer, w.fee);
        _emitCover(coverRoutes);
    }

    function _hash(uint256 left, uint256 right) private view returns (uint256) {
        return hasher.poseidon([left, right]);
    }

    function _validateCover(bytes32[] calldata routes) private pure {
        if (routes.length < 2 || routes.length > 3) revert InvalidCoverCount();
        for (uint256 i; i < routes.length; ++i) {
            if (routes[i] == bytes32(0)) revert InvalidCoverCount();
            for (uint256 j; j < i; ++j) if (routes[i] == routes[j]) revert InvalidCoverCount();
        }
    }

    function _emitCover(bytes32[] calldata routes) private {
        for (uint256 i; i < routes.length; ++i) emit CoverTraffic(routes[i], 0);
    }
}
