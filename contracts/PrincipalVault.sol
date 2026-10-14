// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePool, IAToken} from "./interfaces/External.sol";

/// @notice Immutable custody extension. Only the shielded pool can create or redeem liabilities.
/// @dev Accounting cannot guarantee solvency or liquidity of the external lending market.
contract PrincipalVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable asset;
    IAavePool public immutable lendingPool;
    IAToken public immutable aToken;
    address public immutable shieldedPool;
    address public immutable treasury;
    uint256 public immutable reserveBps;
    uint256 public principal;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAmount();
    error UnsupportedToken();
    error Insolvent();
    error InexactWithdrawal();
    event Invested(uint256 amount);
    event Harvested(uint256 amount);

    constructor(IERC20 asset_, IAavePool lendingPool_, IAToken aToken_, address treasury_, uint256 reserveBps_) {
        if (address(asset_).code.length == 0 || address(lendingPool_).code.length == 0
            || address(aToken_).code.length == 0 || treasury_ == address(0) || reserveBps_ > 10_000
            || aToken_.UNDERLYING_ASSET_ADDRESS() != address(asset_) || aToken_.POOL() != address(lendingPool_)) {
            revert InvalidConfiguration();
        }
        asset = asset_;
        lendingPool = lendingPool_;
        aToken = aToken_;
        shieldedPool = msg.sender;
        treasury = treasury_;
        reserveBps = reserveBps_;
    }

    modifier onlyPool() {
        if (msg.sender != shieldedPool) revert Unauthorized();
        _;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) + aToken.balanceOf(address(this));
    }

    function surplus() public view returns (uint256) {
        uint256 assets = totalAssets();
        return assets > principal ? assets - principal : 0;
    }

    function depositFrom(address depositor, uint256 amount) external onlyPool nonReentrant {
        if (amount == 0) revert InvalidAmount();
        // New deposits must not conceal an existing loss.
        if (totalAssets() < principal) revert Insolvent();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(depositor, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
        principal += amount;
    }

    function withdrawTo(address recipient, address relayer, uint256 amount, uint256 fee)
        external onlyPool nonReentrant
    {
        if (amount == 0 || amount > principal || fee >= amount || recipient == address(0)
            || recipient == address(this) || (fee != 0 && (relayer == address(0) || relayer == address(this)))) {
            revert InvalidAmount();
        }
        if (totalAssets() < principal) revert Insolvent();
        _makeLiquid(amount);
        principal -= amount;
        _transferExact(recipient, amount - fee);
        if (fee != 0) _transferExact(relayer, fee);
        if (totalAssets() < principal) revert Insolvent();
    }

    // A keeper may call this permissionlessly. Aave failures never gate deposit or buffered withdrawal.
    function investIdle() external nonReentrant returns (uint256 amount) {
        if (totalAssets() < principal) revert Insolvent();
        uint256 target = Math.mulDiv(principal, reserveBps, 10_000, Math.Rounding.Ceil);
        uint256 idle = asset.balanceOf(address(this));
        if (idle <= target) return 0;
        amount = idle - target;
        asset.forceApprove(address(lendingPool), amount);
        lendingPool.supply(address(asset), amount, address(this), 0);
        asset.forceApprove(address(lendingPool), 0);
        if (totalAssets() < principal) revert Insolvent();
        emit Invested(amount);
    }

    // Yield is paid only to the immutable treasury, after realizing enough underlying.
    function harvest(uint256 maxAmount) external nonReentrant returns (uint256 amount) {
        if (totalAssets() < principal) revert Insolvent();
        amount = Math.min(surplus(), maxAmount);
        if (amount == 0) return 0;
        uint256 reserve = Math.mulDiv(principal, reserveBps, 10_000, Math.Rounding.Ceil);
        _makeLiquid(amount + reserve);
        _transferExact(treasury, amount);
        if (totalAssets() < principal) revert Insolvent();
        emit Harvested(amount);
    }

    function _makeLiquid(uint256 amount) private {
        uint256 idle = asset.balanceOf(address(this));
        if (idle < amount) {
            uint256 missing = amount - idle;
            uint256 received = lendingPool.withdraw(address(asset), missing, address(this));
            if (received != missing || asset.balanceOf(address(this)) < amount) revert InexactWithdrawal();
        }
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert UnsupportedToken();
    }
}
