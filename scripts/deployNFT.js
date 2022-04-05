async function main() {
    const Contract = await ethers.getContractFactory("VictoriaVRLand");
    const contract = await Contract.deploy("VR Land", "VRLAND", "ipfs://", 1649462400);

    console.log("StakeVR deployed to: " + contract.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});