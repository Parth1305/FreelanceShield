const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("FreelanceShield", (m) => {
  const deployer = m.getAccount(0);
  const feeRecipient = m.getParameter("feeRecipient", deployer);

  const escrowImplementation = m.contract("Escrow");
  const disputeResolver = m.contract("DisputeResolver", [deployer]);
  const reputationRegistry = m.contract("ReputationRegistry", [deployer]);
  const escrowFactory = m.contract("EscrowFactory", [
    deployer,
    escrowImplementation,
    disputeResolver,
    reputationRegistry,
    feeRecipient,
  ]);

  m.call(disputeResolver, "setRegistrar", [escrowFactory, true], { id: "AuthorizeFactoryInResolver" });
  m.call(reputationRegistry, "setRegistrar", [escrowFactory, true], { id: "AuthorizeFactoryInRegistry" });

  return { escrowImplementation, disputeResolver, reputationRegistry, escrowFactory };
});
