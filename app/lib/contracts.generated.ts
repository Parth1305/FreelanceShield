import type { Address } from "viem";

export type FreelanceShieldContractConfig = {
  chainId: 11155111;
  network: "sepolia";
  escrowImplementation: Address | null;
  disputeResolver: Address | null;
  reputationRegistry: Address | null;
  escrowFactory: Address | null;
};

// Generated after a Sepolia deployment; null means no verified deployment has been made yet.
export const freelanceShieldContracts: FreelanceShieldContractConfig = {
  chainId: 11155111,
  network: "sepolia",
  escrowImplementation: null,
  disputeResolver: null,
  reputationRegistry: null,
  escrowFactory: null,
};
