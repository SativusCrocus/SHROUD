// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// TEST ONLY. These contracts offer no privacy, price discovery, or external yield.
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAavePool, IAToken, ISwapRouter, IPoseidon, IWithdrawalVerifier} from "../../contracts/interfaces/External.sol";

interface ITransferHook { function onTransfer() external; }

contract MockAsset is ERC20 {
    bool public tax;
    ITransferHook public hook;
    constructor() ERC20("Local Test Asset", "TEST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
    function setTax(bool enabled) external { tax = enabled; }
    function setHook(ITransferHook hook_) external { hook = hook_; }
    function _update(address from, address to, uint256 amount) internal override {
        if (tax && from != address(0) && to != address(0) && amount > 1) {
            super._update(from, address(0), 1);
            amount -= 1;
        }
        super._update(from, to, amount);
        if (address(hook) != address(0)) hook.onTransfer();
    }
}

contract MockAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    address public immutable POOL;
    constructor(address asset) ERC20("Local aToken", "aTEST") {
        UNDERLYING_ASSET_ADDRESS = asset;
        POOL = msg.sender;
    }
    function mint(address to, uint256 amount) external { require(msg.sender == POOL); _mint(to, amount); }
    function burn(address from, uint256 amount) external { require(msg.sender == POOL); _burn(from, amount); }
}

contract MockAave is IAavePool {
    MockAsset public immutable asset;
    MockAToken public immutable aToken;
    bool public illiquid;
    bool public supplyPaused;
    bool public partialWithdrawal;
    constructor(MockAsset asset_) { asset = asset_; aToken = new MockAToken(address(asset_)); }
    function setIlliquid(bool value) external { illiquid = value; }
    function setSupplyPaused(bool value) external { supplyPaused = value; }
    function setPartial(bool value) external { partialWithdrawal = value; }
    function supply(address token, uint256 amount, address beneficiary, uint16) external {
        require(!supplyPaused && token == address(asset), "supply unavailable");
        require(asset.transferFrom(msg.sender, address(this), amount));
        aToken.mint(beneficiary, amount);
    }
    function withdraw(address token, uint256 amount, address to) external returns (uint256) {
        require(!illiquid && token == address(asset), "liquidity unavailable");
        if (partialWithdrawal) amount /= 2;
        aToken.burn(msg.sender, amount);
        require(asset.transfer(to, amount));
        return amount;
    }
    function addYield(address beneficiary, uint256 amount) external {
        asset.mint(address(this), amount);
        aToken.mint(beneficiary, amount);
    }
    function lose(address beneficiary, uint256 amount) external {
        aToken.burn(beneficiary, amount);
        asset.burn(address(this), amount);
    }
}

contract MockRouter is ISwapRouter {
    bool public shortOutput;
    function setShortOutput(bool value) external { shortOutput = value; }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        require(block.timestamp <= p.deadline);
        require(IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn));
        amountOut = shortOutput ? 1 : p.amountIn * 2;
        require(IERC20(p.tokenOut).transfer(p.recipient, amountOut));
        // Deliberately ignores minOut to exercise the treasury's independent output check.
    }
}

contract TEST_ONLY_MockHasher is IPoseidon {
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(inputs))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }
}

contract TEST_ONLY_MockVerifier is IWithdrawalVerifier {
    bool public valid = true;
    function setValid(bool value) external { valid = value; }
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[7] calldata)
        external view returns (bool) { return valid; }
}
