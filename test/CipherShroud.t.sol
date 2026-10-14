// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {CipherShroudPool} from "../contracts/CipherShroudPool.sol";
import {PrincipalVault} from "../contracts/PrincipalVault.sol";
import {BuybackTreasury} from "../contracts/BuybackTreasury.sol";
import {ShroudToken} from "../contracts/ShroudToken.sol";
import {IAToken} from "../contracts/interfaces/External.sol";
import {MockAsset, MockAave, MockRouter, TEST_ONLY_MockHasher, TEST_ONLY_MockVerifier, ITransferHook} from "./mocks/Mocks.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function prank(address) external;
}

contract ReentryProbe is ITransferHook {
    CipherShroudPool immutable pool;
    bool public attempted;
    bool public succeeded;
    bytes4 public failure;
    constructor(CipherShroudPool pool_) { pool = pool_; }
    function onTransfer() external {
        attempted = true;
        bytes32[] memory routes = new bytes32[](2);
        routes[0] = bytes32(uint256(1)); routes[1] = bytes32(uint256(2));
        bytes memory result;
        (succeeded, result) = address(pool).call(abi.encodeCall(pool.deposit, (999, routes)));
        if (result.length >= 4) failure = bytes4(result);
    }
}

contract CipherShroudTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockAsset asset;
    MockAave aave;
    MockRouter router;
    TEST_ONLY_MockVerifier verifier;
    ShroudToken shroud;
    BuybackTreasury treasury;
    CipherShroudPool pool;
    PrincipalVault vault;
    address constant RECIPIENT = address(0xBEEF);

    function setUp() public {
        asset = new MockAsset();
        aave = new MockAave(asset);
        router = new MockRouter();
        verifier = new TEST_ONLY_MockVerifier();
        shroud = new ShroudToken(address(this), 1_000_000 ether);
        treasury = new BuybackTreasury(asset, shroud, router, 3000, address(this));
        pool = new CipherShroudPool(asset, 100 ether, new TEST_ONLY_MockHasher(), verifier,
            aave, IAToken(address(aave.aToken())), address(treasury), 2000);
        vault = pool.vault();
        asset.mint(address(this), 10_000 ether);
        asset.approve(address(vault), type(uint256).max);
        shroud.transfer(address(router), 100_000 ether);
    }

    function cover() internal pure returns (bytes32[] memory routes) {
        routes = new bytes32[](2); routes[0] = bytes32(uint256(11)); routes[1] = bytes32(uint256(22));
    }

    function withdrawal(uint256 nullifier) internal view returns (CipherShroudPool.Withdrawal memory w) {
        w.root = pool.latestRoot(); w.nullifierHash = nullifier; w.recipient = RECIPIENT;
    }

    function deposit() internal { pool.deposit(123, cover()); }

    function testPrincipalSurvivesHarvestAndBurn() public {
        deposit();
        vault.investIdle();
        require(asset.balanceOf(address(vault)) == 20 ether, "reserve");
        aave.addYield(address(vault), 10 ether);
        require(vault.harvest(type(uint256).max) == 10 ether, "surplus only");
        require(asset.balanceOf(address(vault)) == 20 ether, "harvest preserves reserve");
        uint256 supply = shroud.totalSupply();
        treasury.buyback(10 ether, 20 ether, block.timestamp + 60);
        require(shroud.totalSupply() == supply - 20 ether, "burn");
        require(asset.allowance(address(treasury), address(router)) == 0, "router approval");
        pool.withdraw(withdrawal(1), cover());
        require(asset.balanceOf(RECIPIENT) == 100 ether, "exact principal");
        require(vault.principal() == 0, "liability retired");
    }

    function testFuzzYieldCannotConsumePrincipal(uint96 yieldAmount) public {
        deposit();
        vault.investIdle();
        aave.addYield(address(vault), yieldAmount);
        vault.harvest(type(uint256).max);
        require(vault.totalAssets() >= vault.principal(), "backing");
        require(asset.balanceOf(address(treasury)) == yieldAmount, "yield attribution");
        pool.withdraw(withdrawal(1), cover());
        require(asset.balanceOf(RECIPIENT) == 100 ether, "principal");
    }

    function testReplayRejected() public {
        deposit();
        CipherShroudPool.Withdrawal memory w = withdrawal(1);
        pool.withdraw(w, cover());
        vm.expectRevert(CipherShroudPool.InvalidWithdrawal.selector);
        pool.withdraw(w, cover());
    }

    function testIlliquidityRevertsNullifierAndCanRetry() public {
        deposit(); vault.investIdle();
        aave.setIlliquid(true);
        CipherShroudPool.Withdrawal memory w = withdrawal(1);
        vm.expectRevert(); pool.withdraw(w, cover());
        require(!pool.spent(1) && vault.principal() == 100 ether, "atomic rollback");
        aave.setIlliquid(false);
        pool.withdraw(w, cover());
    }

    function testPartialLendingWithdrawalReverts() public {
        deposit(); vault.investIdle(); aave.setPartial(true);
        CipherShroudPool.Withdrawal memory w = withdrawal(1);
        vm.expectRevert(PrincipalVault.InexactWithdrawal.selector); pool.withdraw(w, cover());
        require(!pool.spent(1), "nullifier rollback");
    }

    function testLossBlocksNewDepositsAndHarvest() public {
        deposit(); vault.investIdle(); aave.lose(address(vault), 1 ether);
        vm.expectRevert(PrincipalVault.Insolvent.selector); vault.harvest(1);
        vm.expectRevert(PrincipalVault.Insolvent.selector); pool.deposit(456, cover());
        require(!pool.commitments(456) && pool.nextIndex() == 1, "deposit rollback");
    }

    function testPausedSupplyDoesNotGateDepositsOrIdleWithdrawals() public {
        aave.setSupplyPaused(true);
        deposit();
        vm.expectRevert(); vault.investIdle();
        pool.withdraw(withdrawal(1), cover());
    }

    function testFeeConservesPrincipal() public {
        deposit();
        CipherShroudPool.Withdrawal memory w = withdrawal(1);
        w.relayer = address(0xCAFE); w.fee = 1 ether;
        pool.withdraw(w, cover());
        require(asset.balanceOf(RECIPIENT) == 99 ether, "net recipient");
        require(asset.balanceOf(w.relayer) == 1 ether, "bound fee");
    }

    function testInvalidProofLeavesStateUntouched() public {
        deposit(); verifier.setValid(false);
        CipherShroudPool.Withdrawal memory w = withdrawal(1);
        vm.expectRevert(CipherShroudPool.InvalidProof.selector); pool.withdraw(w, cover());
        require(!pool.spent(1) && vault.principal() == 100 ether, "proof rollback");
    }

    function testDuplicateAndOutOfFieldCommitmentsRejected() public {
        deposit();
        vm.expectRevert(CipherShroudPool.InvalidCommitment.selector); pool.deposit(123, cover());
        uint256 field = pool.FIELD();
        vm.expectRevert(CipherShroudPool.InvalidCommitment.selector); pool.deposit(field, cover());
    }

    function testFeeOnTransferTokenRejected() public {
        asset.setTax(true);
        vm.expectRevert(PrincipalVault.UnsupportedToken.selector); pool.deposit(123, cover());
        require(vault.principal() == 0 && pool.nextIndex() == 0, "no unbacked note");
    }

    function testVaultAccessControl() public {
        vm.expectRevert(PrincipalVault.Unauthorized.selector); vault.depositFrom(address(this), 1);
        vm.expectRevert(PrincipalVault.Unauthorized.selector); vault.withdrawTo(RECIPIENT, address(0), 1, 0);
    }

    function testMaliciousTokenCannotReenterPool() public {
        ReentryProbe probe = new ReentryProbe(pool);
        asset.setHook(probe);
        deposit();
        require(probe.attempted() && !probe.succeeded(), "reentry blocked");
        require(probe.failure() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "reentrancy guard");
        require(pool.nextIndex() == 1 && vault.principal() == 100 ether, "single deposit");
    }

    function testKeeperAndSlippageChecks() public {
        asset.mint(address(treasury), 10 ether);
        vm.prank(RECIPIENT); vm.expectRevert(BuybackTreasury.Unauthorized.selector);
        treasury.buyback(10 ether, 1, block.timestamp);
        router.setShortOutput(true);
        vm.expectRevert(BuybackTreasury.InvalidTrade.selector);
        treasury.buyback(10 ether, 20 ether, block.timestamp);
        require(asset.balanceOf(address(treasury)) == 10 ether, "failed swap atomic");
        vm.expectRevert(BuybackTreasury.InvalidTrade.selector);
        treasury.buyback(1, 0, block.timestamp);
    }

    function testPaddingCannotChangeFinancialState() public {
        bytes32[] memory bad = new bytes32[](4);
        vm.expectRevert(CipherShroudPool.InvalidCoverCount.selector); pool.deposit(123, bad);
        bad = cover(); bad[1] = bad[0];
        vm.expectRevert(CipherShroudPool.InvalidCoverCount.selector); pool.deposit(123, bad);
        require(vault.principal() == 0, "padding not money");
    }

    function testOldRootsExpireAfterHistoryWindow() public {
        uint256 oldRoot = pool.latestRoot();
        for (uint256 i = 1; i <= 100; i++) pool.deposit(i, cover());
        require(!pool.isKnownRoot(oldRoot), "root history bounded");
        require(pool.isKnownRoot(pool.latestRoot()), "latest root valid");
    }
}
