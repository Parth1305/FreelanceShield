const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("FreelanceShield contracts", function () {
  const firstAmount = ethers.parseEther("1");
  const secondAmount = ethers.parseEther("2");
  const fee = ethers.parseEther("0.05");
  const deliveryHash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://delivery-one"));

  async function deploySystem() {
    const [owner, client, freelancer, arbiter, feeRecipient, outsider, alternate] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const implementation = await Escrow.deploy();
    const Resolver = await ethers.getContractFactory("DisputeResolver");
    const resolver = await Resolver.deploy(owner.address);
    const Registry = await ethers.getContractFactory("ReputationRegistry");
    const registry = await Registry.deploy(owner.address);
    const Factory = await ethers.getContractFactory("EscrowFactory");
    const factory = await Factory.deploy(
      owner.address,
      await implementation.getAddress(),
      await resolver.getAddress(),
      await registry.getAddress(),
      feeRecipient.address,
    );

    await resolver.setRegistrar(await factory.getAddress(), true);
    await registry.setRegistrar(await factory.getAddress(), true);

    return { owner, client, freelancer, arbiter, feeRecipient, outsider, alternate, implementation, resolver, registry, factory };
  }

  async function createProject(system, options = {}) {
    const client = options.client ?? system.client.address;
    const freelancer = options.freelancer ?? system.freelancer.address;
    const arbiter = options.arbiter ?? system.arbiter.address;
    const amounts = options.amounts ?? [firstAmount, secondAmount];
    const projectFee = options.fee ?? fee;
    await system.factory.createEscrow(client, freelancer, arbiter, projectFee, amounts);
    const escrows = await system.factory.getClientEscrows(client);
    return ethers.getContractAt("Escrow", escrows.at(-1));
  }

  describe("factory and initialization", function () {
    it("deploys and atomically authorizes an ERC-1167 clone", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system);
      const address = await escrow.getAddress();

      expect(await system.factory.isEscrow(address)).to.equal(true);
      expect(await system.resolver.authorizedEscrows(address)).to.equal(true);
      expect(await system.registry.authorizedReporters(address)).to.equal(true);
      expect(await escrow.factory()).to.equal(await system.factory.getAddress());
      expect(await escrow.client()).to.equal(system.client.address);
      expect(await escrow.freelancer()).to.equal(system.freelancer.address);
      expect(await escrow.arbiter()).to.equal(system.arbiter.address);
      expect(await escrow.milestoneCount()).to.equal(2);
      expect(await escrow.requiredFunding()).to.equal(firstAmount + secondAmount + fee);
      expect((await system.factory.getFreelancerEscrows(system.freelancer.address))[0]).to.equal(address);
    });

    it("locks the implementation and rejects malformed projects", async function () {
      const system = await loadFixture(deploySystem);
      await expect(
        system.implementation.initialize(
          system.owner.address,
          system.client.address,
          system.freelancer.address,
          system.arbiter.address,
          system.feeRecipient.address,
          await system.resolver.getAddress(),
          await system.registry.getAddress(),
          fee,
          [firstAmount],
        ),
      ).to.be.revertedWithCustomError(system.implementation, "InvalidInitialization");

      await expect(
        system.factory.createEscrow(ethers.ZeroAddress, system.freelancer.address, system.arbiter.address, fee, [firstAmount]),
      ).to.be.revertedWithCustomError(system.factory, "InvalidAddress");
      await expect(
        system.factory.createEscrow(system.client.address, system.client.address, system.arbiter.address, fee, [firstAmount]),
      ).to.be.revertedWithCustomError(system.implementation, "InvalidMilestones");
      await expect(
        system.factory.createEscrow(system.client.address, system.freelancer.address, system.arbiter.address, fee, []),
      ).to.be.revertedWithCustomError(system.implementation, "InvalidMilestones");
      await expect(
        system.factory.createEscrow(system.client.address, system.freelancer.address, system.arbiter.address, fee, [0]),
      ).to.be.revertedWithCustomError(system.implementation, "InvalidMilestones");

      const CloneDeployer = await ethers.getContractFactory("TestCloneDeployer");
      const cloneDeployer = await CloneDeployer.deploy();
      const deployerAddress = await cloneDeployer.getAddress();
      const valid = [
        await system.implementation.getAddress(),
        deployerAddress,
        system.client.address,
        system.freelancer.address,
        system.arbiter.address,
        system.feeRecipient.address,
        await system.resolver.getAddress(),
        await system.registry.getAddress(),
        fee,
        [firstAmount],
      ];
      await expect(cloneDeployer.deployAndInitialize(...valid.map((value, index) => index === 1 ? system.owner.address : value)))
        .to.be.revertedWithCustomError(system.implementation, "Unauthorized");
      for (const index of [2, 3, 4, 5, 6, 7]) {
        const invalid = [...valid];
        invalid[index] = ethers.ZeroAddress;
        await expect(cloneDeployer.deployAndInitialize(...invalid))
          .to.be.revertedWithCustomError(system.implementation, "InvalidAddress");
      }
    });

    it("restricts factory administration", async function () {
      const system = await loadFixture(deploySystem);
      await expect(system.factory.connect(system.outsider).setFeeRecipient(system.alternate.address))
        .to.be.revertedWithCustomError(system.factory, "OwnableUnauthorizedAccount");
      await expect(system.factory.setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWithCustomError(system.factory, "InvalidAddress");
      await expect(system.factory.setFeeRecipient(system.alternate.address))
        .to.emit(system.factory, "FeeRecipientUpdated").withArgs(system.alternate.address);
    });
  });

  describe("normal milestone lifecycle", function () {
    it("accepts exact client funding once", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system);
      const required = await escrow.requiredFunding();

      await expect(escrow.connect(system.outsider).fund({ value: required })).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(system.client).fund({ value: required - 1n })).to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await expect(escrow.connect(system.client).fund({ value: required }))
        .to.emit(escrow, "Funded").withArgs(system.client.address, required);
      await expect(escrow.connect(system.client).fund({ value: required })).to.be.revertedWithCustomError(escrow, "AlreadyFunded");
    });

    it("supports submission, rejection, and corrected resubmission", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system);
      await expect(escrow.connect(system.freelancer).submitMilestone(0, deliveryHash)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await expect(escrow.connect(system.client).submitMilestone(0, deliveryHash)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(system.freelancer).submitMilestone(0, ethers.ZeroHash)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.freelancer).submitMilestone(8, deliveryHash)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.freelancer).submitMilestone(0, deliveryHash))
        .to.emit(escrow, "MilestoneSubmitted").withArgs(0, deliveryHash);
      await expect(escrow.connect(system.freelancer).submitMilestone(0, deliveryHash)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.client).rejectMilestone(0)).to.emit(escrow, "MilestoneRejected").withArgs(0);
      await expect(escrow.connect(system.client).approveMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.outsider).rejectMilestone(0)).to.be.revertedWithCustomError(escrow, "Unauthorized");

      const correctedHash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://corrected"));
      await escrow.connect(system.freelancer).submitMilestone(0, correctedHash);
      expect((await escrow.getMilestone(0)).deliverableHash).to.equal(correctedHash);
    });

    it("releases each milestone exactly once and records completion", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system);
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await escrow.connect(system.freelancer).submitMilestone(0, deliveryHash);

      await expect(escrow.connect(system.outsider).approveMilestone(0)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(system.client).approveMilestone(0))
        .to.emit(escrow, "MilestoneReleased").withArgs(0, 0, firstAmount);
      expect(await escrow.withdrawable(system.freelancer.address)).to.equal(firstAmount);
      expect((await escrow.getMilestone(0)).status).to.equal(4);
      await expect(escrow.connect(system.client).approveMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");

      await expect(escrow.connect(system.freelancer).withdraw()).to.changeEtherBalances(
        [escrow, system.freelancer], [-firstAmount, firstAmount],
      );
      await expect(escrow.connect(system.freelancer).withdraw()).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");

      const secondHash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://delivery-two"));
      await escrow.connect(system.freelancer).submitMilestone(1, secondHash);
      await expect(escrow.connect(system.client).approveMilestone(1)).to.emit(escrow, "ProjectCompleted");
      expect(await escrow.completed()).to.equal(true);
      expect(await escrow.withdrawable(system.freelancer.address)).to.equal(secondAmount);
      expect(await escrow.withdrawable(system.feeRecipient.address)).to.equal(fee);
      const reputation = await system.registry.getReputation(system.freelancer.address);
      expect(reputation.completedContracts).to.equal(1);
      expect(reputation.disputesOpened).to.equal(0);
      expect(await system.registry.scoreOf(system.freelancer.address)).to.equal(55);
      await expect(escrow.connect(system.feeRecipient).withdraw()).to.changeEtherBalances([escrow, system.feeRecipient], [-fee, fee]);
      await expect(escrow.connect(system.freelancer).submitMilestone(0, deliveryHash)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.client).approveMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.client).rejectMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(system.client).raiseDispute(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("rejects out-of-range and invalid-state lifecycle calls", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system);
      await expect(escrow.getMilestone(20)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.connect(system.client).approveMilestone(20)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.connect(system.client).rejectMilestone(20)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.connect(system.client).raiseDispute(20)).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(escrow.connect(system.outsider).raiseDispute(0)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(system.client).rejectMilestone(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  describe("dispute lifecycle", function () {
    it("hands a case to the designated arbiter and supports split awards", async function () {
      const system = await loadFixture(deploySystem);
      const escrow = await createProject(system, { amounts: [firstAmount] });
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await expect(escrow.connect(system.client).raiseDispute(0)).to.be.revertedWithCustomError(escrow, "InvalidState");
      await escrow.connect(system.freelancer).submitMilestone(0, deliveryHash);
      await expect(escrow.connect(system.client).raiseDispute(0)).to.emit(escrow, "DisputeRaised");
      await expect(escrow.connect(system.freelancer).raiseDispute(0)).to.be.revertedWithCustomError(escrow, "InvalidState");

      const disputeId = await system.resolver.getDisputeId(await escrow.getAddress(), 0);
      const dispute = await system.resolver.getDispute(disputeId);
      expect(dispute.arbiter).to.equal(system.arbiter.address);
      expect(dispute.amount).to.equal(firstAmount);
      await expect(escrow.connect(system.outsider).resolveDispute(0, firstAmount, 0)).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(system.resolver.connect(system.outsider).resolve(disputeId, firstAmount, 0)).to.be.revertedWithCustomError(system.resolver, "Unauthorized");
      await expect(system.resolver.connect(system.arbiter).resolve(disputeId, 1, 1)).to.be.revertedWithCustomError(system.resolver, "InvalidAward");

      const clientAward = ethers.parseEther("0.25");
      const freelancerAward = ethers.parseEther("0.75");
      await expect(system.resolver.connect(system.arbiter).resolve(disputeId, clientAward, freelancerAward))
        .to.emit(escrow, "MilestoneReleased").withArgs(0, clientAward, freelancerAward);
      expect(await escrow.withdrawable(system.client.address)).to.equal(clientAward);
      expect(await escrow.withdrawable(system.freelancer.address)).to.equal(freelancerAward);
      expect(await escrow.completed()).to.equal(true);
      await expect(system.resolver.connect(system.arbiter).resolve(disputeId, clientAward, freelancerAward))
        .to.be.revertedWithCustomError(system.resolver, "DisputeNotOpen");

      const freelancerReputation = await system.registry.getReputation(system.freelancer.address);
      expect(freelancerReputation.disputesOpened).to.equal(1);
      expect(freelancerReputation.disputesWon).to.equal(1);
      expect((await system.registry.getReputation(system.client.address)).disputesLost).to.equal(1);
    });

    it("allows a freelancer to dispute a rejection and records client/tied outcomes", async function () {
      const system = await loadFixture(deploySystem);
      const clientWin = await createProject(system, { amounts: [firstAmount] });
      await clientWin.connect(system.client).fund({ value: await clientWin.requiredFunding() });
      await clientWin.connect(system.freelancer).submitMilestone(0, deliveryHash);
      await clientWin.connect(system.client).rejectMilestone(0);
      await clientWin.connect(system.freelancer).raiseDispute(0);
      const clientWinId = await system.resolver.getDisputeId(await clientWin.getAddress(), 0);
      await system.resolver.connect(system.arbiter).resolve(clientWinId, firstAmount, 0);
      expect((await system.registry.getReputation(system.client.address)).disputesWon).to.equal(1);

      const tied = await createProject(system, { amounts: [firstAmount] });
      await tied.connect(system.client).fund({ value: await tied.requiredFunding() });
      await tied.connect(system.freelancer).submitMilestone(0, deliveryHash);
      await tied.connect(system.client).raiseDispute(0);
      const tiedId = await system.resolver.getDisputeId(await tied.getAddress(), 0);
      await system.resolver.connect(system.arbiter).resolve(tiedId, firstAmount / 2n, firstAmount / 2n);
      expect((await system.registry.getReputation(system.client.address)).disputesWon).to.equal(1);
      expect((await system.registry.getReputation(system.freelancer.address)).disputesWon).to.equal(0);
    });

    it("rejects fabricated resolver and reputation calls", async function () {
      const system = await loadFixture(deploySystem);
      await expect(
        system.resolver.connect(system.outsider).openDispute(0, system.client.address, system.freelancer.address, system.arbiter.address, firstAmount),
      ).to.be.revertedWithCustomError(system.resolver, "Unauthorized");
      await expect(system.resolver.connect(system.outsider).authorizeEscrow(system.alternate.address, true))
        .to.be.revertedWithCustomError(system.resolver, "Unauthorized");
      await expect(system.registry.connect(system.outsider).authorizeReporter(system.alternate.address, true))
        .to.be.revertedWithCustomError(system.registry, "Unauthorized");
      await expect(
        system.registry.connect(system.outsider).recordContractResult(system.client.address, system.freelancer.address, false, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(system.registry, "Unauthorized");
    });

    it("validates resolver callbacks before settling escrow state", async function () {
      const system = await loadFixture(deploySystem);
      const CloneDeployer = await ethers.getContractFactory("TestCloneDeployer");
      const cloneDeployer = await CloneDeployer.deploy();
      const ResolverHarness = await ethers.getContractFactory("ResolverHarness");
      const resolverHarness = await ResolverHarness.deploy();
      const cloneDeployerAddress = await cloneDeployer.getAddress();

      await cloneDeployer.deployAndInitialize(
        await system.implementation.getAddress(),
        cloneDeployerAddress,
        system.client.address,
        system.freelancer.address,
        system.arbiter.address,
        system.feeRecipient.address,
        await resolverHarness.getAddress(),
        await system.registry.getAddress(),
        fee,
        [firstAmount, secondAmount],
      );
      const escrow = await ethers.getContractAt("Escrow", await cloneDeployer.lastClone());
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await escrow.connect(system.freelancer).submitMilestone(0, deliveryHash);
      await escrow.connect(system.client).raiseDispute(0);

      await expect(resolverHarness.resolve(await escrow.getAddress(), 99, 0, firstAmount))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestones");
      await expect(resolverHarness.resolve(await escrow.getAddress(), 1, 0, secondAmount))
        .to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(resolverHarness.resolve(await escrow.getAddress(), 0, 0, 1))
        .to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await resolverHarness.resolve(await escrow.getAddress(), 0, 0, firstAmount);
      await expect(resolverHarness.resolve(await escrow.getAddress(), 0, 0, firstAmount))
        .to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });

  describe("reentrancy protection", function () {
    it("blocks a recursive withdrawal while preserving the legitimate payout", async function () {
      const system = await loadFixture(deploySystem);
      const Attacker = await ethers.getContractFactory("ReentrantWithdrawer");
      const attacker = await Attacker.deploy();
      const escrow = await createProject(system, { freelancer: await attacker.getAddress(), amounts: [firstAmount] });
      await attacker.setEscrow(await escrow.getAddress());
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await attacker.submit(0, deliveryHash);

      // Approval only records a pull-payment credit; it never invokes freelancer code.
      await escrow.connect(system.client).approveMilestone(0);
      expect(await attacker.attempted()).to.equal(false);
      await attacker.attack();
      expect(await attacker.attempted()).to.equal(true);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await escrow.withdrawable(await attacker.getAddress())).to.equal(0);
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(firstAmount);
    });

    it("restores credit when a recipient rejects ETH", async function () {
      const system = await loadFixture(deploySystem);
      const Rejecting = await ethers.getContractFactory("RejectingWithdrawer");
      const rejecting = await Rejecting.deploy();
      const escrow = await createProject(system, { freelancer: await rejecting.getAddress(), amounts: [firstAmount] });
      await rejecting.setEscrow(await escrow.getAddress());
      await escrow.connect(system.client).fund({ value: await escrow.requiredFunding() });
      await rejecting.submit(0, deliveryHash);
      await escrow.connect(system.client).approveMilestone(0);

      await expect(rejecting.withdraw()).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.withdrawable(await rejecting.getAddress())).to.equal(firstAmount);
    });
  });
});
