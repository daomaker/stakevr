const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("StakeVR contract", function() {
    let deployer, user1, user2, user3, contract, stakingToken, stakingTokenDecimals;

    const PRECISION_LOSS = "1000000000000000";
    
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

    before(async () => {
        [deployer, user1, user2, user3] = await ethers.getSigners();
    });

    describe("Full flow test", async() => {
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
    });
});