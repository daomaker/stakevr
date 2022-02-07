const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("StakeVR contract", function() {
    let deployer, user1, user2, user3, contract, claimContract, stakingToken, stakingTokenDecimals;

    const PRECISION_LOSS = "1000000000000000000";
    const CLAIM_START_DELAY = 300;
    
    const parseUnits = (value, decimals = stakingTokenDecimals) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const init = async(minLockDays, maxLockDays, stakeBonusLong, stakeBonusMore, stakingTokenDecimals = 18) => {
        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        stakingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", deployer.address, parseUnits(1e12), stakingTokenDecimals);

        const Contract = await ethers.getContractFactory("StakeVR");
        contract = await Contract.deploy(
            stakingToken.address,
            minLockDays,
            maxLockDays,
            stakeBonusLong,
            stakeBonusMore
        );

        expect(await contract.stakingToken()).to.equal(stakingToken.address);
        expect(await contract.minLockDays()).to.equal(minLockDays);
        expect(await contract.maxLockDays()).to.equal(maxLockDays);
        expect(await contract.shareBonusPerYear()).to.equal(stakeBonusLong);
        expect(await contract.shareBonusPer1MTokens()).to.equal(stakeBonusMore);

        await stakingToken.transfer(user1.address, parseUnits(1e11));
        await stakingToken.transfer(user2.address, parseUnits(1e11));
        await stakingToken.transfer(user3.address, parseUnits(1e11));

        stakingToken = stakingToken.connect(user1);
        await stakingToken.approve(contract.address, parseUnits(1e11));
        stakingToken = stakingToken.connect(user2);
        await stakingToken.approve(contract.address, parseUnits(1e11));
        stakingToken = stakingToken.connect(user3);
        await stakingToken.approve(contract.address, parseUnits(1e11));

        const startTime = Number(await time.latest()) + CLAIM_START_DELAY;
        const ClaimContract = await ethers.getContractFactory("ClaimVR");
        claimContract = await ClaimContract.deploy(
            contract.address,
            stakingToken.address,
            startTime
        );

        expect(await claimContract.rewardToken()).to.equal(stakingToken.address);
        expect(await claimContract.stakeVR()).to.equal(contract.address);
        expect(await claimContract.startTime()).to.equal(startTime);
        expect(await claimContract.getPassedMonthsCount()).to.equal(0);

        stakingToken = stakingToken.connect(deployer);
        await stakingToken.approve(claimContract.address, parseUnits(1e12));
    }

    const stake = async(user, amount, lockDays, expectedShares, expectedLongTermBonus) => {
        contract = contract.connect(user);
        amount = parseUnits(amount);
        expectedShares = parseUnits(expectedShares);
        expectedLongTermBonus = parseUnits(expectedLongTermBonus);
        
        const totalSharesBefore = await contract.totalShares();
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        await contract.stake(amount, lockDays);
        const totalSharesAfter = await contract.totalShares();
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);

        const calculateSharesResult = await contract.calculateShares(amount, lockDays);
        expect(calculateSharesResult[0]).to.closeTo(expectedShares, PRECISION_LOSS);
        expect(calculateSharesResult[1]).to.closeTo(expectedLongTermBonus, PRECISION_LOSS);
        expect(totalSharesAfter).to.equal(totalSharesBefore.add(calculateSharesResult[0]));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.add(amount));

        const timeNow = Number(await time.latest());
        const stakeIndex = Number(await contract.stakerStakeCount(user.address)) - 1;
        const stakeInfo = await contract.stakers(user.address, stakeIndex);
        expect(stakeInfo.unstaked).to.equal(false);
        expect(stakeInfo.amount).to.equal(amount);
        expect(stakeInfo.lockTimestamp).to.equal(timeNow);
        expect(stakeInfo.lockDays).to.equal(lockDays);
    }

    const stakeSimple = async(user, amount, lockDays) => {
        contract = contract.connect(user);
        amount = parseUnits(amount);
        
        const totalSharesBefore = await contract.totalShares();
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        await contract.stake(amount, lockDays);
        const totalSharesAfter = await contract.totalShares();
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);

        const calculateSharesResult = await contract.calculateShares(amount, lockDays);
        expect(totalSharesAfter).to.equal(totalSharesBefore.add(calculateSharesResult[0]));
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.add(amount));

        const timeNow = Number(await time.latest());
        const stakeIndex = Number(await contract.stakerStakeCount(user.address)) - 1;
        const stakeInfo = await contract.stakers(user.address, stakeIndex);
        expect(stakeInfo.unstaked).to.equal(false);
        expect(stakeInfo.amount).to.equal(amount);
        expect(stakeInfo.lockTimestamp).to.equal(timeNow);
        expect(stakeInfo.lockDays).to.equal(lockDays);
    }

    const unstake = async(user, stakeIndex, tooEarly, unstakedAlready) => {
        contract = contract.connect(user);

        if (tooEarly) {
            await expect(contract.unstake(stakeIndex)).to.be.revertedWith("StakeVR: unstaking too early");
            return;
        }

        if (unstakedAlready) {
            await expect(contract.unstake(stakeIndex)).to.be.revertedWith("StakeVR: unstaked already");
            return;
        }

        const stakeInfoBefore = await contract.stakers(user.address, stakeIndex);
        const calculateSharesResult = await contract.calculateShares(stakeInfoBefore.amount, stakeInfoBefore.lockDays);

        const totalSharesBefore = await contract.totalShares();
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        const stakerBalanceBefore = await stakingToken.balanceOf(user.address);
        await contract.unstake(stakeIndex);
        const totalSharesAfter = await contract.totalShares();
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);
        const stakerBalanceAfter = await stakingToken.balanceOf(user.address);

        expect(totalSharesBefore).to.equal(totalSharesAfter.add(calculateSharesResult[0]));
        expect(contractBalanceBefore).to.equal(contractBalanceAfter.add(stakeInfoBefore.amount));
        expect(stakerBalanceAfter).to.equal(stakerBalanceBefore.add(stakeInfoBefore.amount));

        const stakeInfoAfter = await contract.stakers(user.address, stakeIndex);
        expect(stakeInfoAfter.unstaked).to.equal(true);
    }

    const claim = async(user, expectedReward) => {
        if (expectedReward == 0) {
            await expect(claimContract.claim(user.address)).to.be.revertedWith("ClaimVR: nothing to claim");
            return;
        }

        expectedReward = parseUnits(expectedReward);
        const reward = await claimContract.callStatic.claim(user.address);
        expect(reward).to.closeTo(expectedReward, PRECISION_LOSS);

        const contractBalanceBefore = await stakingToken.balanceOf(claimContract.address);
        const stakerBalanceBefore = await stakingToken.balanceOf(user.address);
        await claimContract.claim(user.address);
        const contractBalanceAfter = await stakingToken.balanceOf(claimContract.address);
        const stakerBalanceAfter = await stakingToken.balanceOf(user.address);

        expect(contractBalanceBefore).to.equal(contractBalanceAfter.add(reward));
        expect(stakerBalanceAfter).to.equal(stakerBalanceBefore.add(reward));

        const passedMonthsCount = await claimContract.getPassedMonthsCount();
        const claimedMonthsCount = await claimContract.stakers(user.address);
        expect(claimedMonthsCount).to.equal(passedMonthsCount);
    }

    const fundRewards = async(monthRewards, monthsOffset = 0) => {
        claimContract = claimContract.connect(deployer);
        monthRewards = monthRewards.map(reward => parseUnits(reward));
        const totalReward = monthRewards.reduce((c, r) => c.add(r), ethers.BigNumber.from("0"));

        const startMonth = (await claimContract.getPassedMonthsCount()) + monthsOffset;
        const monthsRewardBefore = [];
        for (let i = 0; i < monthRewards.length; i++) {
            monthsRewardBefore[i] = (await claimContract.data(startMonth + i)).reward;
        }

        const contractBalanceBefore = await stakingToken.balanceOf(claimContract.address);
        await claimContract.fundRewards(monthRewards, monthsOffset);
        const contractBalanceAfter = await stakingToken.balanceOf(claimContract.address);
        expect(contractBalanceBefore).to.equal(contractBalanceAfter.sub(totalReward));

        for (let i = 0; i < monthRewards.length; i++) {
            const monthRewardAfter = (await claimContract.data(startMonth + i)).reward;
            expect(monthsRewardBefore[i]).to.equal(monthRewardAfter.sub(monthRewards[i]));
        }
    }

    before(async () => {
        [deployer, user1, user2, user3] = await ethers.getSigners();
    });

    /*describe("Full flow test", async() => {
        before(async() => {
            await init(
                30,
                3650,
                1000,
                1000
            );
        });

        it("min max lock days", async() => {
            contract = contract.connect(user1);
            await expect(contract.stake(parseUnits(1), 1)).to.be.revertedWith("StakeVR: invalid lockDays");
            await expect(contract.stake(parseUnits(1), 3651)).to.be.revertedWith("StakeVR: invalid lockDays");
        });
        
        it("staking", async() => {
            await stake(user1, 1, 30, 1.083, 0.083);
            await stake(user1, 1, 365, 2, 1);
            await stake(user1, 10, 365, 20, 10);
            await stake(user1, 1000, 365, 2001, 1000);

            const stakerInfo = await contract.getStakerInfo(user1.address);
            expect(stakerInfo[0]).to.closeTo(parseUnits(1012), PRECISION_LOSS);
            expect(stakerInfo[1]).to.closeTo(parseUnits(2024.082), PRECISION_LOSS);

            await stake(user2, 1000000, 365, 3000000, 1000000);
            await stake(user2, 100, 730, 300.01, 200);
            await stake(user2, 10000, 730, 30100, 20000);
            await stake(user3, 100, 3650, 1100.01, 1000);
            await stake(user3, 1000000000, 30, 1001082191780.822, 82191780.822);
            await stake(user3, 2000000, 730, 10000000, 4000000);
        });

        it("unstaking", async() => {
            await expect(contract.unstake(100)).to.be.revertedWith("StakeVR: invalid index");

            await time.increase(time.duration.days(29));
            await unstake(user1, 0, true, false);
            await time.increase(time.duration.days(1));
            await unstake(user1, 0, false, false);
            await unstake(user1, 0, false, true);

            await time.increase(time.duration.days(365 - 31));
            await unstake(user1, 1, true, false);
            await time.increase(time.duration.days(1));
            await unstake(user1, 1, false, false);
            await unstake(user1, 1, false, true);

            const stakerInfo = await contract.getStakerInfo(user1.address);
            expect(stakerInfo[0]).to.equal(parseUnits(1010));
            expect(stakerInfo[1]).to.closeTo(parseUnits(2021), PRECISION_LOSS);

            await unstake(user2, 0, false, false);
            await unstake(user2, 1, true, false);
            await unstake(user3, 1, false, false);

            await time.increase(time.duration.days(3650));
            await unstake(user2, 1, false, false);
            await unstake(user3, 1, false, true);
            await unstake(user3, 0, false, false);

            await stake(user2, 10000, 365, 20100, 10000);
        });
    });*/

    describe("Claiming test", async() => {
        before(async() => {
            await init(
                30,
                3650,
                1000,
                50
            );
        });

        it("before start time", async() => {
            await fundRewards([500, 1000, 1500, 2000, 2500]);
            await fundRewards([500, 1000, 1500, 2000, 2500]);

            await stakeSimple(user1, 500, 30);
            await stakeSimple(user1, 500, 30);
            await stakeSimple(user2, 1000, 30);
            await claim(user1, 0);

            await time.increase(CLAIM_START_DELAY);
            expect(await claimContract.getPassedMonthsCount()).to.equal(1);
        });

        it("1st month - user 1 claims", async() => {
            await claim(user1, 500);
            await claim(user1, 0);
        });

        it("1st month - user 2 stakes again", async() => {
            await stakeSimple(user2, 1000, 30);
        });

        it("2nd month - user 1 claims", async() => {
            await time.increase(2592000);

            await claim(user1, 666);
            await claim(user1, 0);
        });

        it("2nd month - user 2 claims", async() => {
            await claim(user2, 1833);
            await claim(user2, 0);
        });

        it("2nd month - user 3 stakes", async() => {
            await stakeSimple(user3, 3000, 30);
            await claim(user3, 0);
        });

        it("4th month - user 1 claims", async() => {
            await time.increase(2592000 * 2);
            
            await claim(user1, 1166);
            await claim(user1, 0);
        });

        it("4th month - user 2 claims", async() => {
            await claim(user2, 2333);
            await claim(user2, 0);
        });

        it("5th month - user 3 claims", async() => {
            await time.increase(2592000);

            await claim(user3, 6000);
            await claim(user3, 0);
        });

        it("6th month - no additional rewards", async() => {
            await time.increase(2592000);
            await claim(user3, 0);
            await claim(user2, 1666);
            await claim(user1, 833);
        });

        it("6th month - refund 8th month", async() => {
            await fundRewards([1000], 1);
        });

        it("7th month - no rewards", async() => {
            await time.increase(2592000);
            await claim(user3, 0);
            await claim(user2, 0);
            await claim(user1, 0);
        });

        it("7th month - user 3 unstakes", async() => {
            await unstake(user3, 0, false, false);
        });

        it("8th month - users claim", async() => {
            await time.increase(2592000);
            await claim(user3, 0);
            await claim(user2, 666);
            await claim(user1, 333);
        });
    });
});