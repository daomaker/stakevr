// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract StakeVR is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint32 constant HUNDRED_PERCENT = 1e3;

    struct Stake {
        bool unstaked;
        uint128 amount;
        uint48 lockTimestamp;
        uint16 lockDays;
    }

    IERC20 public stakingToken;
    mapping(address => Stake[]) public stakers;
    uint192 public totalShares;
    uint16 public minLockDays;
    uint16 public maxLockDays;
    uint16 public shareBonusPerYear;
    uint16 public shareBonusPer1MTokens;

    event EStake(
        address staker,
        uint128 amount,
        uint192 shares,
        uint48 lockTimestamp,
        uint16 lockDays
    );

    event EUnstake(
        address staker,
        uint stakeIndex
    );

    constructor(
        IERC20 _stakingToken,
        uint16 _minLockDays,
        uint16 _maxLockDays,
        uint16 _shareBonusPerYear,
        uint16 _shareBonusPer1MTokens
    ) {
        require(address(_stakingToken) != address(0));
        require(_minLockDays <= _maxLockDays, "StakeVR: minLockDays > maxLockDays");
        stakingToken = _stakingToken;
        minLockDays = _minLockDays;
        maxLockDays = _maxLockDays;
        shareBonusPerYear = _shareBonusPerYear;
        shareBonusPer1MTokens = _shareBonusPer1MTokens;
    }

    function stake(uint128 amount, uint16 lockDays) external nonReentrant {
        require(lockDays >= minLockDays && lockDays <= maxLockDays, "StakeVR: invalid lockDays");
        (uint192 shares,,) = calculateShares(amount, lockDays);
        totalShares += shares;

        stakers[msg.sender].push(Stake(
            false,
            amount,
            uint48(block.timestamp),
            lockDays
        ));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit EStake(msg.sender, amount, shares, uint48(block.timestamp), lockDays);
    }

    function unstake(uint stakeIndex) external nonReentrant {
        require(stakeIndex < stakers[msg.sender].length, "StakeVR: invalid index");
        Stake storage stakeRef = stakers[msg.sender][stakeIndex];
        require(!stakeRef.unstaked, "StakeVR: unstaked already");
        require(stakeRef.lockTimestamp + uint48(stakeRef.lockDays) * 86400 <= block.timestamp, "StakeVR: unstaking too early");

        (uint192 shares,,) = calculateShares(stakeRef.amount, stakeRef.lockDays);
        totalShares -= shares;
        stakeRef.unstaked = true;
        stakingToken.safeTransfer(msg.sender, stakeRef.amount);
        emit EUnstake(msg.sender, stakeIndex);
    }

    function calculateShares(
        uint amount, 
        uint lockDays
    ) public view returns (
        uint192 shares,
        uint longTermBonus,
        uint stakingMoreBonus
    ) {
        longTermBonus = lockDays * shareBonusPerYear / 365;
        stakingMoreBonus = amount * shareBonusPer1MTokens / 1e24;
        shares = uint192(amount + amount * (longTermBonus + stakingMoreBonus) / HUNDRED_PERCENT);
    }

    function getStakerInfo(
        address stakerAddress
    ) public view returns (
        uint256 totalStakeAmount,
        uint256 totalStakerShares
    ) {
        for (uint i = 0; i < stakers[stakerAddress].length; i++) {
            Stake storage stakeRef = stakers[stakerAddress][i];
            if (stakeRef.unstaked) continue;

            totalStakeAmount += stakeRef.amount;
            (uint192 shares,,) = calculateShares(stakeRef.amount, stakeRef.lockDays);
            totalStakerShares += shares;
        }
    }

    function stakerStakeCount(address stakerAddress) public view returns (uint) {
        return stakers[stakerAddress].length;
    }
}