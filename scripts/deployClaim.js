async function main() {
    const stakeVR = "0x362a80d4c5cf2a1c4c134cde21836f6fc2ae81ce";
    const rewardToken = "0x7d5121505149065b562c789a0145ed750e6e8cdd";
    const startTime = 1646229600;//Math.floor(Date.now() / 1000) + 60 * 30;

    const ClaimVR = await ethers.getContractFactory("ClaimVR");
    const claimVR = await ClaimVR.deploy(stakeVR, rewardToken, startTime);

    console.log("ClaimVR deployed to: " + claimVR.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});