// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./StakeVR.sol";

contract ClaimVR is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant ACC_REWARD_MULTIPLIER = 1e36;
    uint256 internal constant SECS_PER_MONTH = 2592000;

    struct Staker {
        uint48 claimedMonthsCount;
    }

    struct Data {
        uint128 reward;
        uint256 accRewardPerShare;
    }

    mapping(address => Staker) public stakers;
    mapping(uint => Data) public data;

    IERC20 public rewardToken;
    StakeVR public stakeVR;
    uint48 public startTime;
    uint48 passedMonthsCount;
    
    event Claim(
        address staker,
        uint128 reward,
        uint48 passedMonthsCount
    );

    event FundRewards(
        address funder,
        uint128[] monthRewards,
        uint48 startMonth
    );

    constructor(
        StakeVR _stakeVR,
        IERC20 _rewardToken,
        uint48 _startTime
    ) {
        stakeVR = _stakeVR;
        rewardToken = _rewardToken;
        startTime = _startTime;
    }

    /** 
        Anyone can claim for any staker, but the reward always goes to the staker's address.
    */
    function claim(address staker) external nonReentrant returns (uint128 reward) {
        update();
        require(passedMonthsCount > 0, "ClaimVR: nothing to claim");

        reward = getStakerReward(staker);
        require(reward > 0, "ClaimVR: nothing to claim");

        stakers[staker].claimedMonthsCount = passedMonthsCount;
        rewardToken.safeTransfer(staker, reward);

        emit Claim(staker, reward, passedMonthsCount);
    }

    /**
        Anyone can fund rewards.
        Rewards are funded from the upcoming month (if monthOffset is 0).
     */
    function fundRewards(uint128[] calldata monthRewards, uint48 monthsOffset) external nonReentrant {
        update();

        uint48 month = passedMonthsCount + monthsOffset;
        uint128 rewards;
        for (uint i = 0; i < monthRewards.length; i++) {
            data[month].reward += monthRewards[i];
            rewards += monthRewards[i];
            month++;
        }

        rewardToken.safeTransferFrom(msg.sender, address(this), rewards);
        emit FundRewards(msg.sender, monthRewards, passedMonthsCount + monthsOffset);
    }

    /**
        Updates passedMonthsCount and accRewardPerShare for each passed month.
     */
    function update() public {
        uint48 prevPassedMonthsCount = passedMonthsCount;
        uint48 currentPassedMonthsCount = getPassedMonthsCount();

        if (prevPassedMonthsCount < currentPassedMonthsCount) {
            uint128 rewards;
            while (prevPassedMonthsCount++ < currentPassedMonthsCount) {
                rewards += data[prevPassedMonthsCount - 1].reward;
            }
            prevPassedMonthsCount = passedMonthsCount;

            uint192 totalShares = stakeVR.totalShares();
            uint256 accRewardPerShare = prevPassedMonthsCount > 0 ? data[prevPassedMonthsCount - 1].accRewardPerShare : 0;
            accRewardPerShare += ACC_REWARD_MULTIPLIER * rewards / totalShares;

            data[currentPassedMonthsCount - 1].accRewardPerShare = accRewardPerShare;
            passedMonthsCount = currentPassedMonthsCount;
        }
    }
    
    /**
        Reward is calculated based on all of the staker's active stakes and their start timestamps.
        Stakers that unstake before claiming forfeit their past rewards. 
     */
    function getStakerReward(address staker) public view returns (uint128 reward) {
        uint stakesCount = stakeVR.stakerStakeCount(staker);
        uint48 claimedMonthsCount = stakers[staker].claimedMonthsCount;
        uint256 currentAccRewardPerShare = data[passedMonthsCount - 1].accRewardPerShare;

        for (uint i = 0; i < stakesCount; i++) {
            (bool unstaked, uint128 amount, uint48 lockTimestamp, uint16 lockDays) = stakeVR.stakers(staker, i);
            if (unstaked) continue;

            uint48 stakedAtMonth = _getMonthForTimestamp(lockTimestamp);
            if (stakedAtMonth == passedMonthsCount) continue;
            if (stakedAtMonth < claimedMonthsCount) stakedAtMonth = claimedMonthsCount;

            (uint192 shares,) = stakeVR.calculateShares(amount, lockDays);
            uint256 lastAccRewardPerShare = stakedAtMonth > 0 ? data[stakedAtMonth - 1].accRewardPerShare : 0;
            reward += uint128((currentAccRewardPerShare - lastAccRewardPerShare) * shares / ACC_REWARD_MULTIPLIER);
        }
    }

    function getPassedMonthsCount() public view returns (uint48) {
        return _getMonthForTimestamp(block.timestamp);
    }

    function _getMonthForTimestamp(uint timestamp) private view returns (uint48) {
        if (timestamp < startTime) return 0;

        return uint48((timestamp - startTime) / SECS_PER_MONTH) + 1;
    }
}