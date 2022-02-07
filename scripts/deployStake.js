async function main() {
    const stakingToken = "0x7d5121505149065b562c789a0145ed750e6e8cdd";
    const minLockDays = 30;
    const maxLockDays = 3650;
    const shareBonusPerYear = 8000;
    const shareBonusPer1MTokens = 60;

    const StakeVR = await ethers.getContractFactory("StakeVR");
    const stakeVR = await StakeVR.deploy(stakingToken, minLockDays, maxLockDays, shareBonusPerYear, shareBonusPer1MTokens);

    console.log("StakeVR deployed to: " + stakeVR.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});