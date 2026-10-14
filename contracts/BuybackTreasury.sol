// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShroudToken} from "./ShroudToken.sol";
import {ISwapRouter} from "./interfaces/External.sol";

contract BuybackTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable asset;
    ShroudToken public immutable shroud;
    ISwapRouter public immutable router;
    uint24 public immutable feeTier;
    address public keeper;
    error InvalidConfiguration();
    error Unauthorized();
    error InvalidTrade();
    event KeeperChanged(address indexed keeper);
    event BoughtAndBurned(uint256 assetsSpent, uint256 shroudBurned);

    constructor(IERC20 asset_, ShroudToken shroud_, ISwapRouter router_, uint24 feeTier_, address owner_)
        Ownable(owner_)
    {
        if (address(asset_).code.length == 0 || address(shroud_).code.length == 0
            || address(router_).code.length == 0 || address(asset_) == address(shroud_) || feeTier_ == 0) {
            revert InvalidConfiguration();
        }
        asset = asset_;
        shroud = shroud_;
        router = router_;
        feeTier = feeTier_;
        keeper = owner_;
    }

    function setKeeper(address next) external onlyOwner {
        keeper = next;
        emit KeeperChanged(next);
    }

    // The keeper must derive minOut from an independent quote/oracle and its slippage policy.
    // The contract enforces minOut but cannot judge the quality of that quote.
    function buyback(uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant returns (uint256 bought) {
        if (msg.sender != keeper) revert Unauthorized();
        if (amount == 0 || minOut == 0 || deadline < block.timestamp || deadline > block.timestamp + 300) {
            revert InvalidTrade();
        }
        uint256 beforeBalance = shroud.balanceOf(address(this));
        uint256 beforeAssets = asset.balanceOf(address(this));
        asset.forceApprove(address(router), amount);
        router.exactInputSingle(ISwapRouter.ExactInputSingleParams({
            tokenIn: address(asset), tokenOut: address(shroud), fee: feeTier, recipient: address(this),
            deadline: deadline, amountIn: amount, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
        asset.forceApprove(address(router), 0);
        bought = shroud.balanceOf(address(this)) - beforeBalance;
        if (bought < minOut || beforeAssets - asset.balanceOf(address(this)) != amount) revert InvalidTrade();
        shroud.burn(bought);
        emit BoughtAndBurned(amount, bought);
    }
}
