import type { Address, Hex } from "viem";
import type { EscrowState, Milestone, Project, User } from "@/db/schema";

export type ProjectBundle = {
  project: Project;
  milestones: Milestone[];
  client: User;
  freelancer: User;
  escrowState: EscrowState | null;
};

export type NewProjectInput = {
  id: string;
  clientId: string;
  freelancerId: string;
  title: string;
  description: string;
  arbiterAddress: Address;
  feeAmountWei: string;
  milestones: Array<{
    id: string;
    position: number;
    title: string;
    description: string;
    amountWei: string;
  }>;
};

export type ChainMilestone = {
  position: number;
  amountWei: string;
  status: "pending" | "submitted" | "rejected" | "disputed" | "resolved";
  deliverableHash: Hex;
};

export type EscrowSnapshot = {
  address: Address;
  funded: boolean;
  completed: boolean;
  hadDispute: boolean;
  requiredFundingWei: string;
  contractBalanceWei: string;
  clientWithdrawableWei: string;
  freelancerWithdrawableWei: string;
  remainingMilestones: number;
  lastBlockNumber: string;
  milestones: ChainMilestone[];
};

export type MilestoneAction = "submit" | "approve" | "reject" | "dispute";

export type PreparedTransaction = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string;
};
