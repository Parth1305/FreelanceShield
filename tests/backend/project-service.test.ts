import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import type { Address, Hex } from "viem";
import type { EscrowState, Milestone, Project, User } from "../../db/schema";
import type { AuthenticatedUser } from "../../server/auth";
import type { ChainGateway } from "../../server/chain-gateway";
import { ApiError } from "../../server/http";
import type { ProjectRepository } from "../../server/project-repository";
import { ProjectService } from "../../server/project-service";
import type {
  EscrowSnapshot,
  MilestoneAction,
  NewProjectInput,
  PreparedTransaction,
  ProjectBundle,
} from "../../server/project-types";

const clientWallet = "0x1111111111111111111111111111111111111111" as Address;
const freelancerWallet = "0x2222222222222222222222222222222222222222" as Address;
const arbiterWallet = "0x3333333333333333333333333333333333333333" as Address;
const escrowAddress = "0x4444444444444444444444444444444444444444" as Address;
const txHash = `0x${"ab".repeat(32)}` as Hex;
const emptyHash = `0x${"00".repeat(32)}` as Hex;
const now = new Date("2026-08-25T00:00:00.000Z");

const client: User = {
  id: "client-id",
  email: "client@example.com",
  passwordHash: "hash",
  role: "client",
  walletAddress: clientWallet,
  createdAt: now,
  updatedAt: now,
};
const freelancer: User = {
  id: "freelancer-id",
  email: "freelancer@example.com",
  passwordHash: "hash",
  role: "freelancer",
  walletAddress: freelancerWallet,
  createdAt: now,
  updatedAt: now,
};
const clientActor: AuthenticatedUser = {
  id: client.id,
  email: client.email,
  role: client.role,
  walletAddress: client.walletAddress,
};
const freelancerActor: AuthenticatedUser = {
  id: freelancer.id,
  email: freelancer.email,
  role: freelancer.role,
  walletAddress: freelancer.walletAddress,
};

function snapshot(status: EscrowSnapshot["milestones"][number]["status"] = "pending"): EscrowSnapshot {
  return {
    address: escrowAddress,
    funded: status !== "pending",
    completed: status === "resolved",
    hadDispute: status === "disputed",
    requiredFundingWei: "101",
    contractBalanceWei: status === "resolved" ? "1" : "101",
    clientWithdrawableWei: "0",
    freelancerWithdrawableWei: status === "resolved" ? "100" : "0",
    remainingMilestones: status === "resolved" ? 0 : 1,
    lastBlockNumber: "12345",
    milestones: [{ position: 0, amountWei: "100", status, deliverableHash: emptyHash }],
  };
}

class MemoryRepository implements ProjectRepository {
  users = new Map([[client.id, client], [freelancer.id, freelancer]]);
  bundle: ProjectBundle | null = null;
  failedProjectId: string | null = null;
  deliverable: { uri: string; hash: Hex } | null = null;

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }
  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createUser(): Promise<User> {
    throw new Error("not used");
  }
  async createProject(input: NewProjectInput): Promise<ProjectBundle> {
    const project: Project = {
      id: input.id,
      clientId: input.clientId,
      freelancerId: input.freelancerId,
      title: input.title,
      description: input.description,
      arbiterAddress: input.arbiterAddress,
      feeAmountWei: input.feeAmountWei,
      escrowAddress: null,
      factoryTransactionHash: null,
      chainId: 11155111,
      status: "deploying",
      createdAt: now,
      updatedAt: now,
    };
    const projectMilestones: Milestone[] = input.milestones.map((milestone) => ({
      ...milestone,
      projectId: input.id,
      deliverableHash: null,
      deliverableUri: null,
      status: "pending",
      submittedAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    this.bundle = { project, milestones: projectMilestones, client, freelancer, escrowState: null };
    return this.bundle;
  }
  async markProjectDeployed(projectId: string, address: Address, transactionHash: Hex) {
    assert.equal(this.bundle?.project.id, projectId);
    this.bundle!.project.escrowAddress = address;
    this.bundle!.project.factoryTransactionHash = transactionHash;
    this.bundle!.project.status = "awaiting_funding";
  }
  async markProjectFailed(projectId: string) {
    this.failedProjectId = projectId;
    if (this.bundle) this.bundle.project.status = "failed";
  }
  async listProjectsForUser(userId: string) {
    return this.bundle && [this.bundle.client.id, this.bundle.freelancer.id].includes(userId)
      ? [this.bundle.project]
      : [];
  }
  async getProjectBundle(projectId: string) {
    return this.bundle?.project.id === projectId ? this.bundle : null;
  }
  async setMilestoneDeliverable(_projectId: string, _position: number, uri: string, hash: Hex) {
    this.deliverable = { uri, hash };
  }
  async reconcileProject(_projectId: string, chainState: EscrowSnapshot) {
    if (!this.bundle) throw new Error("missing bundle");
    this.bundle.project.status = chainState.completed
      ? "completed"
      : chainState.hadDispute
        ? "disputed"
        : chainState.funded
          ? "active"
          : "awaiting_funding";
    this.bundle.milestones[0].status = chainState.milestones[0].status;
    this.bundle.escrowState = {
      projectId: this.bundle.project.id,
      escrowAddress: chainState.address,
      funded: chainState.funded,
      completed: chainState.completed,
      hadDispute: chainState.hadDispute,
      requiredFundingWei: chainState.requiredFundingWei,
      contractBalanceWei: chainState.contractBalanceWei,
      clientWithdrawableWei: chainState.clientWithdrawableWei,
      freelancerWithdrawableWei: chainState.freelancerWithdrawableWei,
      remainingMilestones: chainState.remainingMilestones,
      lastBlockNumber: chainState.lastBlockNumber,
      lastSyncedAt: now,
    } satisfies EscrowState;
    return this.bundle;
  }
}

class FakeChain implements ChainGateway {
  deployed = false;
  prepared: { action: MilestoneAction; actor: Address; deliverableHash?: Hex } | null = null;
  confirmed = false;
  state = snapshot();
  deploymentError: Error | null = null;

  async deployEscrow() {
    if (this.deploymentError) throw this.deploymentError;
    this.deployed = true;
    return { escrowAddress, transactionHash: txHash };
  }
  async prepareMilestoneAction(input: {
    actor: Address;
    action: MilestoneAction;
    deliverableHash?: Hex;
  }): Promise<PreparedTransaction> {
    this.prepared = input;
    return { chainId: 11155111, from: input.actor, to: escrowAddress, data: "0x1234", value: "0" };
  }
  async confirmMilestoneAction() {
    this.confirmed = true;
    this.state = snapshot("submitted");
    return this.state;
  }
  async readEscrow() {
    return this.state;
  }
}

function createPayload() {
  return {
    title: "Landing page redesign",
    description: "A portfolio project",
    freelancerEmail: freelancer.email,
    arbiterAddress: arbiterWallet,
    feeAmountWei: "1",
    milestones: [{ title: "Design", description: "Final Figma", amountWei: "100" }],
  };
}

async function deployedFixture() {
  const repository = new MemoryRepository();
  const chain = new FakeChain();
  const service = new ProjectService(repository, chain);
  const created = await service.createProject(clientActor, createPayload());
  return { repository, chain, service, created };
}

test("client project creation deploys an escrow and reconciles its initial state", async () => {
  const { chain, created } = await deployedFixture();
  assert.equal(chain.deployed, true);
  assert.equal(created.project.escrowAddress, escrowAddress);
  assert.equal(created.project.status, "awaiting_funding");
  assert.equal(created.deployment.transactionHash, txHash);
});

test("failed factory deployment marks the staged project failed", async () => {
  const repository = new MemoryRepository();
  const chain = new FakeChain();
  chain.deploymentError = new Error("factory reverted");
  const service = new ProjectService(repository, chain);
  await assert.rejects(() => service.createProject(clientActor, createPayload()), /factory reverted/);
  assert.equal(repository.bundle?.project.status, "failed");
  assert.equal(repository.failedProjectId, repository.bundle?.project.id);
});

test("freelancer submission is prepared for wallet signature with a deterministic hash", async () => {
  const { repository, chain, service } = await deployedFixture();
  const milestoneId = repository.bundle!.milestones[0].id;
  const result = await service.milestoneAction(
    freelancerActor,
    repository.bundle!.project.id,
    milestoneId,
    "submit",
    { deliverableUri: "ipfs://deliverable-v1" },
  );
  assert.equal(result.mode, "wallet_signature");
  assert.equal(chain.prepared?.actor, freelancerWallet);
  assert.equal(chain.prepared?.deliverableHash, keccak256(toBytes("ipfs://deliverable-v1")));
});

test("confirmed wallet transaction updates deliverable metadata and mirrored chain state", async () => {
  const { repository, chain, service } = await deployedFixture();
  const milestoneId = repository.bundle!.milestones[0].id;
  const result = await service.milestoneAction(
    freelancerActor,
    repository.bundle!.project.id,
    milestoneId,
    "submit",
    { deliverableUri: "ipfs://deliverable-v1", transactionHash: txHash },
  );
  assert.equal(result.mode, "confirmed");
  assert.equal(chain.confirmed, true);
  assert.deepEqual(repository.deliverable, {
    uri: "ipfs://deliverable-v1",
    hash: keccak256(toBytes("ipfs://deliverable-v1")),
  });
  assert.equal(repository.bundle?.milestones[0].status, "submitted");
});

test("participant roles are enforced before preparing a contract action", async () => {
  const { repository, service } = await deployedFixture();
  const milestoneId = repository.bundle!.milestones[0].id;
  await assert.rejects(
    () => service.milestoneAction(clientActor, repository.bundle!.project.id, milestoneId, "submit", {
      deliverableUri: "ipfs://wrong-signer",
    }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
  await assert.rejects(
    () => service.milestoneAction(freelancerActor, repository.bundle!.project.id, milestoneId, "approve", {}),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
});
