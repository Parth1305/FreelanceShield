// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
export {};
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["client", "freelancer", "both"] })
      .notNull()
      .default("both"),
    walletAddress: text("wallet_address"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_wallet_address_unique").on(table.walletAddress),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    freelancerId: text("freelancer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    arbiterAddress: text("arbiter_address").notNull(),
    feeAmountWei: text("fee_amount_wei").notNull(),
    escrowAddress: text("escrow_address"),
    factoryTransactionHash: text("factory_transaction_hash"),
    chainId: integer("chain_id").notNull().default(11155111),
    status: text("status", {
      enum: ["deploying", "awaiting_funding", "active", "disputed", "completed", "failed"],
    })
      .notNull()
      .default("deploying"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("projects_client_status_idx").on(table.clientId, table.status),
    index("projects_freelancer_status_idx").on(table.freelancerId, table.status),
    uniqueIndex("projects_escrow_address_unique").on(table.escrowAddress),
  ],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    amountWei: text("amount_wei").notNull(),
    deliverableHash: text("deliverable_hash"),
    deliverableUri: text("deliverable_uri"),
    status: text("status", {
      enum: ["pending", "submitted", "rejected", "disputed", "resolved"],
    })
      .notNull()
      .default("pending"),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("milestones_project_position_unique").on(table.projectId, table.position),
    index("milestones_project_status_idx").on(table.projectId, table.status),
  ],
);

export const escrowStates = sqliteTable(
  "escrow_states",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    escrowAddress: text("escrow_address").notNull(),
    funded: integer("funded", { mode: "boolean" }).notNull().default(false),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    hadDispute: integer("had_dispute", { mode: "boolean" }).notNull().default(false),
    requiredFundingWei: text("required_funding_wei").notNull().default("0"),
    contractBalanceWei: text("contract_balance_wei").notNull().default("0"),
    clientWithdrawableWei: text("client_withdrawable_wei").notNull().default("0"),
    freelancerWithdrawableWei: text("freelancer_withdrawable_wei").notNull().default("0"),
    remainingMilestones: integer("remaining_milestones").notNull().default(0),
    lastBlockNumber: text("last_block_number"),
    lastSyncedAt: timestamp("last_synced_at"),
  },
  (table) => [uniqueIndex("escrow_states_address_unique").on(table.escrowAddress)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type EscrowState = typeof escrowStates.$inferSelect;
