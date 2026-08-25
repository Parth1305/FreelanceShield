import { and, asc, desc, eq, or } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { getDb } from "@/db";
import { escrowStates, milestones, projects, users } from "@/db/schema";
import type { Project, User } from "@/db/schema";
import type { EscrowSnapshot, NewProjectInput, ProjectBundle } from "./project-types";

export interface ProjectRepository {
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: {
    id: string;
    email: string;
    passwordHash: string;
    role: "client" | "freelancer" | "both";
    walletAddress: string | null;
  }): Promise<User>;
  createProject(input: NewProjectInput): Promise<ProjectBundle>;
  markProjectDeployed(projectId: string, escrowAddress: Address, transactionHash: Hex): Promise<void>;
  markProjectFailed(projectId: string): Promise<void>;
  listProjectsForUser(userId: string): Promise<Project[]>;
  getProjectBundle(projectId: string): Promise<ProjectBundle | null>;
  setMilestoneDeliverable(projectId: string, position: number, deliverableUri: string, deliverableHash: Hex): Promise<void>;
  reconcileProject(projectId: string, snapshot: EscrowSnapshot): Promise<ProjectBundle>;
}

function now() {
  return new Date();
}

export class DrizzleProjectRepository implements ProjectRepository {
  private readonly db = getDb();

  async findUserByEmail(email: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async findUserById(id: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async createUser(input: {
    id: string;
    email: string;
    passwordHash: string;
    role: "client" | "freelancer" | "both";
    walletAddress: string | null;
  }): Promise<User> {
    const [user] = await this.db.insert(users).values(input).returning();
    return user;
  }

  async createProject(input: NewProjectInput): Promise<ProjectBundle> {
    const createdAt = now();
    await this.db.batch([
      this.db.insert(projects).values({
        id: input.id,
        clientId: input.clientId,
        freelancerId: input.freelancerId,
        title: input.title,
        description: input.description,
        arbiterAddress: input.arbiterAddress,
        feeAmountWei: input.feeAmountWei,
        status: "deploying",
        createdAt,
        updatedAt: createdAt,
      }),
      this.db.insert(milestones).values(
        input.milestones.map((milestone) => ({
          ...milestone,
          projectId: input.id,
          createdAt,
          updatedAt: createdAt,
        })),
      ),
    ]);
    const bundle = await this.getProjectBundle(input.id);
    if (!bundle) throw new Error("The newly created project could not be read");
    return bundle;
  }

  async markProjectDeployed(projectId: string, escrowAddress: Address, transactionHash: Hex): Promise<void> {
    await this.db
      .update(projects)
      .set({
        escrowAddress,
        factoryTransactionHash: transactionHash,
        status: "awaiting_funding",
        updatedAt: now(),
      })
      .where(eq(projects.id, projectId));
  }

  async markProjectFailed(projectId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ status: "failed", updatedAt: now() })
      .where(eq(projects.id, projectId));
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(or(eq(projects.clientId, userId), eq(projects.freelancerId, userId)))
      .orderBy(desc(projects.updatedAt), desc(projects.createdAt));
  }

  async getProjectBundle(projectId: string): Promise<ProjectBundle | null> {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return null;
    const [projectMilestones, clientRows, freelancerRows, stateRows] = await Promise.all([
      this.db
        .select()
        .from(milestones)
        .where(eq(milestones.projectId, projectId))
        .orderBy(asc(milestones.position)),
      this.db.select().from(users).where(eq(users.id, project.clientId)).limit(1),
      this.db.select().from(users).where(eq(users.id, project.freelancerId)).limit(1),
      this.db.select().from(escrowStates).where(eq(escrowStates.projectId, projectId)).limit(1),
    ]);
    if (!clientRows[0] || !freelancerRows[0]) throw new Error("Project participant record is missing");
    return {
      project,
      milestones: projectMilestones,
      client: clientRows[0],
      freelancer: freelancerRows[0],
      escrowState: stateRows[0] ?? null,
    };
  }

  async setMilestoneDeliverable(
    projectId: string,
    position: number,
    deliverableUri: string,
    deliverableHash: Hex,
  ): Promise<void> {
    await this.db
      .update(milestones)
      .set({ deliverableUri, deliverableHash, updatedAt: now() })
      .where(and(eq(milestones.projectId, projectId), eq(milestones.position, position)));
  }

  async reconcileProject(projectId: string, snapshot: EscrowSnapshot): Promise<ProjectBundle> {
    const syncedAt = now();
    const hasOpenDispute = snapshot.milestones.some((milestone) => milestone.status === "disputed");
    const status = snapshot.completed
      ? "completed"
      : hasOpenDispute
        ? "disputed"
        : snapshot.funded
          ? "active"
          : "awaiting_funding";

    await this.db
      .update(projects)
      .set({ status, updatedAt: syncedAt })
      .where(eq(projects.id, projectId));

    await this.db
      .insert(escrowStates)
      .values({
        projectId,
        escrowAddress: snapshot.address,
        funded: snapshot.funded,
        completed: snapshot.completed,
        hadDispute: snapshot.hadDispute,
        requiredFundingWei: snapshot.requiredFundingWei,
        contractBalanceWei: snapshot.contractBalanceWei,
        clientWithdrawableWei: snapshot.clientWithdrawableWei,
        freelancerWithdrawableWei: snapshot.freelancerWithdrawableWei,
        remainingMilestones: snapshot.remainingMilestones,
        lastBlockNumber: snapshot.lastBlockNumber,
        lastSyncedAt: syncedAt,
      })
      .onConflictDoUpdate({
        target: escrowStates.projectId,
        set: {
          funded: snapshot.funded,
          completed: snapshot.completed,
          hadDispute: snapshot.hadDispute,
          requiredFundingWei: snapshot.requiredFundingWei,
          contractBalanceWei: snapshot.contractBalanceWei,
          clientWithdrawableWei: snapshot.clientWithdrawableWei,
          freelancerWithdrawableWei: snapshot.freelancerWithdrawableWei,
          remainingMilestones: snapshot.remainingMilestones,
          lastBlockNumber: snapshot.lastBlockNumber,
          lastSyncedAt: syncedAt,
        },
      });

    for (const chainMilestone of snapshot.milestones) {
      await this.db
        .update(milestones)
        .set({
          status: chainMilestone.status,
          deliverableHash:
            chainMilestone.deliverableHash ===
            "0x0000000000000000000000000000000000000000000000000000000000000000"
              ? null
              : chainMilestone.deliverableHash,
          submittedAt:
            chainMilestone.status === "submitted" || chainMilestone.status === "rejected" ||
            chainMilestone.status === "disputed" || chainMilestone.status === "resolved"
              ? syncedAt
              : null,
          resolvedAt: chainMilestone.status === "resolved" ? syncedAt : null,
          updatedAt: syncedAt,
        })
        .where(and(eq(milestones.projectId, projectId), eq(milestones.position, chainMilestone.position)));
    }

    const bundle = await this.getProjectBundle(projectId);
    if (!bundle) throw new Error("Reconciled project could not be read");
    return bundle;
  }
}
