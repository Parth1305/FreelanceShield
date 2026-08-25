import { getAddress, isAddress, isHex, keccak256, size, toBytes } from "viem";
import type { Address, Hex } from "viem";
import type { AuthenticatedUser } from "./auth";
import { publicUser } from "./auth";
import type { ChainGateway } from "./chain-gateway";
import { ApiError } from "./http";
import type { ProjectRepository } from "./project-repository";
import type { MilestoneAction, ProjectBundle } from "./project-types";

export type CreateProjectPayload = {
  title?: string;
  description?: string;
  freelancerEmail?: string;
  arbiterAddress?: string;
  feeAmountWei?: string;
  milestones?: Array<{ title?: string; description?: string; amountWei?: string }>;
};

export type MilestoneActionPayload = {
  deliverableUri?: string;
  deliverableHash?: string;
  transactionHash?: string;
};

function parseWei(value: string | undefined, field: string, allowZero: boolean): bigint {
  if (!value || !/^\d+$/.test(value)) throw new ApiError(400, `${field} must be an integer string`, "invalid_amount");
  const parsed = BigInt(value);
  if (allowZero ? parsed < 0n : parsed <= 0n) {
    throw new ApiError(400, `${field} must be ${allowZero ? "non-negative" : "greater than zero"}`, "invalid_amount");
  }
  return parsed;
}

function requiredText(value: string | undefined, field: string, maxLength: number): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(400, `${field} is required`, "invalid_input");
  if (normalized.length > maxLength) throw new ApiError(400, `${field} is too long`, "invalid_input");
  return normalized;
}

function bytes32(value: string | undefined, field: string): Hex | undefined {
  if (!value) return undefined;
  if (!isHex(value, { strict: true }) || size(value) !== 32) {
    throw new ApiError(400, `${field} must be a 32-byte hex value`, "invalid_hash");
  }
  return value.toLowerCase() as Hex;
}

function transactionHash(value: string): Hex {
  const hash = bytes32(value, "transactionHash");
  if (!hash) throw new ApiError(400, "transactionHash is required", "invalid_hash");
  return hash;
}

function serializeBundle(bundle: ProjectBundle) {
  return {
    project: bundle.project,
    milestones: bundle.milestones,
    client: publicUser(bundle.client),
    freelancer: publicUser(bundle.freelancer),
    escrowState: bundle.escrowState,
  };
}

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly chain: ChainGateway,
  ) {}

  async createProject(actor: AuthenticatedUser, payload: CreateProjectPayload) {
    if (actor.role === "freelancer") throw new ApiError(403, "This account cannot create client projects", "forbidden");
    const client = await this.repository.findUserById(actor.id);
    if (!client) throw new ApiError(401, "The authenticated user no longer exists", "invalid_token");
    if (!client.walletAddress || !isAddress(client.walletAddress)) {
      throw new ApiError(409, "Add a valid client wallet address before creating a project", "wallet_required");
    }
    const freelancerEmail = requiredText(payload.freelancerEmail, "freelancerEmail", 254).toLowerCase();
    const freelancer = await this.repository.findUserByEmail(freelancerEmail);
    if (!freelancer) throw new ApiError(404, "No freelancer account uses that email", "freelancer_not_found");
    if (freelancer.role === "client") throw new ApiError(409, "The selected account cannot accept freelance work", "invalid_freelancer");
    if (!freelancer.walletAddress || !isAddress(freelancer.walletAddress)) {
      throw new ApiError(409, "The freelancer must add a wallet address first", "wallet_required");
    }
    if (freelancer.id === client.id) throw new ApiError(409, "Client and freelancer must be different accounts", "invalid_parties");
    if (!payload.arbiterAddress || !isAddress(payload.arbiterAddress)) {
      throw new ApiError(400, "arbiterAddress must be a valid EVM address", "invalid_arbiter");
    }
    if (!Array.isArray(payload.milestones) || payload.milestones.length < 1 || payload.milestones.length > 50) {
      throw new ApiError(400, "A project needs between 1 and 50 milestones", "invalid_milestones");
    }
    const feeAmount = parseWei(payload.feeAmountWei, "feeAmountWei", true);
    const projectId = crypto.randomUUID();
    const milestoneInputs = payload.milestones.map((milestone, position) => ({
      id: crypto.randomUUID(),
      position,
      title: requiredText(milestone.title, `milestones[${position}].title`, 160),
      description: (milestone.description ?? "").trim().slice(0, 4000),
      amountWei: parseWei(milestone.amountWei, `milestones[${position}].amountWei`, false).toString(),
    }));
    await this.repository.createProject({
      id: projectId,
      clientId: client.id,
      freelancerId: freelancer.id,
      title: requiredText(payload.title, "title", 160),
      description: (payload.description ?? "").trim().slice(0, 8000),
      arbiterAddress: getAddress(payload.arbiterAddress),
      feeAmountWei: feeAmount.toString(),
      milestones: milestoneInputs,
    });

    let deployment;
    try {
      deployment = await this.chain.deployEscrow({
        client: getAddress(client.walletAddress),
        freelancer: getAddress(freelancer.walletAddress),
        arbiter: getAddress(payload.arbiterAddress),
        feeAmountWei: feeAmount,
        milestoneAmountsWei: milestoneInputs.map((milestone) => BigInt(milestone.amountWei)),
      });
    } catch (error) {
      await this.repository.markProjectFailed(projectId);
      throw error;
    }
    await this.repository.markProjectDeployed(projectId, deployment.escrowAddress, deployment.transactionHash);
    const snapshot = await this.chain.readEscrow({
      escrowAddress: deployment.escrowAddress,
      client: getAddress(client.walletAddress),
      freelancer: getAddress(freelancer.walletAddress),
    });
    const reconciled = await this.repository.reconcileProject(projectId, snapshot);
    return {
      ...serializeBundle(reconciled),
      deployment: { transactionHash: deployment.transactionHash, escrowAddress: deployment.escrowAddress },
    };
  }

  async listProjects(actor: AuthenticatedUser) {
    return this.repository.listProjectsForUser(actor.id);
  }

  async getProject(actor: AuthenticatedUser, projectId: string) {
    const bundle = await this.authorizedBundle(actor, projectId);
    if (!bundle.project.escrowAddress || !isAddress(bundle.project.escrowAddress)) {
      return { ...serializeBundle(bundle), reconciliation: "database_only" as const };
    }
    const snapshot = await this.chain.readEscrow({
      escrowAddress: getAddress(bundle.project.escrowAddress),
      client: this.wallet(bundle.client.walletAddress, "client"),
      freelancer: this.wallet(bundle.freelancer.walletAddress, "freelancer"),
    });
    const reconciled = await this.repository.reconcileProject(projectId, snapshot);
    return { ...serializeBundle(reconciled), reconciliation: "on_chain" as const };
  }

  async milestoneAction(
    actor: AuthenticatedUser,
    projectId: string,
    milestoneId: string,
    action: MilestoneAction,
    payload: MilestoneActionPayload,
  ) {
    const bundle = await this.authorizedBundle(actor, projectId);
    const milestone = bundle.milestones.find((candidate) => candidate.id === milestoneId);
    if (!milestone) throw new ApiError(404, "Milestone not found", "milestone_not_found");
    if (!bundle.project.escrowAddress || !isAddress(bundle.project.escrowAddress)) {
      throw new ApiError(409, "The project does not have a deployed escrow", "escrow_unavailable");
    }
    const requiredParticipant = action === "submit" ? bundle.freelancer : action === "dispute" ? null : bundle.client;
    if (requiredParticipant && actor.id !== requiredParticipant.id) {
      throw new ApiError(403, `Only the ${action === "submit" ? "freelancer" : "client"} can ${action} this milestone`, "forbidden");
    }
    const actorRecord = actor.id === bundle.client.id ? bundle.client : bundle.freelancer;
    const actorWallet = this.wallet(actorRecord.walletAddress, "actor");
    const escrowAddress = getAddress(bundle.project.escrowAddress);
    const deliverableUri = action === "submit"
      ? requiredText(payload.deliverableUri, "deliverableUri", 2048)
      : undefined;
    const deliverableHash = action === "submit"
      ? bytes32(payload.deliverableHash, "deliverableHash") ?? keccak256(toBytes(deliverableUri!))
      : undefined;

    if (!payload.transactionHash) {
      const transaction = await this.chain.prepareMilestoneAction({
        escrowAddress,
        actor: actorWallet,
        action,
        milestonePosition: milestone.position,
        deliverableHash,
      });
      return { mode: "wallet_signature" as const, transaction, deliverableHash };
    }

    const snapshot = await this.chain.confirmMilestoneAction({
      escrowAddress,
      actor: actorWallet,
      action,
      milestonePosition: milestone.position,
      deliverableHash,
      transactionHash: transactionHash(payload.transactionHash),
      client: this.wallet(bundle.client.walletAddress, "client"),
      freelancer: this.wallet(bundle.freelancer.walletAddress, "freelancer"),
    });
    if (action === "submit") {
      await this.repository.setMilestoneDeliverable(projectId, milestone.position, deliverableUri!, deliverableHash!);
    }
    const reconciled = await this.repository.reconcileProject(projectId, snapshot);
    return { mode: "confirmed" as const, project: serializeBundle(reconciled), transactionHash: payload.transactionHash };
  }

  private async authorizedBundle(actor: AuthenticatedUser, projectId: string): Promise<ProjectBundle> {
    const bundle = await this.repository.getProjectBundle(projectId);
    if (!bundle) throw new ApiError(404, "Project not found", "project_not_found");
    if (actor.id !== bundle.client.id && actor.id !== bundle.freelancer.id) {
      throw new ApiError(403, "You are not a participant in this project", "forbidden");
    }
    return bundle;
  }

  private wallet(value: string | null, party: string): Address {
    if (!value || !isAddress(value)) throw new ApiError(409, `The ${party} wallet is unavailable`, "wallet_required");
    return getAddress(value);
  }
}
