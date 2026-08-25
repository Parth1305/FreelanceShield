import type { Address, Hex } from "viem";

export type AccountRole = "client" | "freelancer" | "both";
export type ProjectStatus =
  | "deploying"
  | "awaiting_funding"
  | "active"
  | "disputed"
  | "completed"
  | "failed";
export type MilestoneStatus = "pending" | "submitted" | "rejected" | "disputed" | "resolved";

export type SafeUser = {
  id: string;
  email: string;
  role: AccountRole;
  walletAddress: Address | null;
};

export type ProjectSummary = {
  id: string;
  clientId: string;
  freelancerId: string;
  title: string;
  description: string;
  arbiterAddress: Address;
  feeAmountWei: string;
  escrowAddress: Address | null;
  factoryTransactionHash: Hex | null;
  chainId: number;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type MilestoneRecord = {
  id: string;
  projectId: string;
  position: number;
  title: string;
  description: string;
  amountWei: string;
  deliverableHash: Hex | null;
  deliverableUri: string | null;
  status: MilestoneStatus;
  submittedAt: string | null;
  resolvedAt: string | null;
};

export type EscrowStateRecord = {
  projectId: string;
  escrowAddress: Address;
  funded: boolean;
  completed: boolean;
  hadDispute: boolean;
  requiredFundingWei: string;
  contractBalanceWei: string;
  clientWithdrawableWei: string;
  freelancerWithdrawableWei: string;
  remainingMilestones: number;
  lastBlockNumber: string | null;
  lastSyncedAt: string;
};

export type ProjectDetails = {
  project: ProjectSummary;
  milestones: MilestoneRecord[];
  client: SafeUser;
  freelancer: SafeUser;
  escrowState: EscrowStateRecord | null;
  reconciliation?: "on_chain" | "database_only";
};

export type PreparedTransaction = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string;
};

export class FrontendApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(path, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  } & T;
  if (!response.ok) {
    throw new FrontendApiError(payload.error ?? "The request could not be completed", response.status, payload.code);
  }
  return payload;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
