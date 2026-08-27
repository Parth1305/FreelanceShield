import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEventLogs,
} from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { freelanceShieldContracts } from "@/app/lib/contracts.generated";
import { ApiError } from "./http";
import type {
  EscrowSnapshot,
  MilestoneAction,
  PreparedTransaction,
} from "./project-types";
import { getRuntimeEnv } from "./runtime-env";

const factoryAbi = parseAbi([
  "function createEscrow(address client, address freelancer, address arbiter, uint256 feeAmount, uint256[] milestoneAmounts) returns (address escrowAddress)",
  "event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, address arbiter, uint256 feeAmount)",
]);

const escrowAbi = parseAbi([
  "function funded() view returns (bool)",
  "function completed() view returns (bool)",
  "function hadDispute() view returns (bool)",
  "function requiredFunding() view returns (uint256)",
  "function remainingMilestones() view returns (uint256)",
  "function milestoneCount() view returns (uint256)",
  "function withdrawable(address) view returns (uint256)",
  "function getMilestone(uint256 milestoneId) view returns ((uint256 amount, uint8 status, bytes32 deliverableHash))",
  "function submitMilestone(uint256 milestoneId, bytes32 deliverableHash)",
  "function approveMilestone(uint256 milestoneId)",
  "function rejectMilestone(uint256 milestoneId)",
  "function raiseDispute(uint256 milestoneId)",
]);

const statusNames = ["pending", "submitted", "rejected", "disputed", "resolved"] as const;

export interface ChainGateway {
  deployEscrow(input: {
    client: Address;
    freelancer: Address;
    arbiter: Address;
    feeAmountWei: bigint;
    milestoneAmountsWei: bigint[];
  }): Promise<{ escrowAddress: Address; transactionHash: Hex }>;
  prepareMilestoneAction(input: {
    escrowAddress: Address;
    actor: Address;
    action: MilestoneAction;
    milestonePosition: number;
    deliverableHash?: Hex;
  }): Promise<PreparedTransaction>;
  confirmMilestoneAction(input: {
    escrowAddress: Address;
    actor: Address;
    action: MilestoneAction;
    milestonePosition: number;
    deliverableHash?: Hex;
    transactionHash: Hex;
    client: Address;
    freelancer: Address;
  }): Promise<EscrowSnapshot>;
  readEscrow(input: {
    escrowAddress: Address;
    client: Address;
    freelancer: Address;
  }): Promise<EscrowSnapshot>;
}

type GatewayConfig = {
  rpcUrl: string;
  factoryAddress: Address;
  relayerPrivateKey?: Hex;
};

function transactionFunction(action: MilestoneAction) {
  if (action === "submit") return "submitMilestone" as const;
  if (action === "approve") return "approveMilestone" as const;
  if (action === "reject") return "rejectMilestone" as const;
  return "raiseDispute" as const;
}

function transactionArgs(action: MilestoneAction, position: number, deliverableHash?: Hex) {
  if (action === "submit") {
    if (!deliverableHash) throw new ApiError(400, "deliverableHash is required", "deliverable_required");
    return [BigInt(position), deliverableHash] as const;
  }
  return [BigInt(position)] as const;
}

export function createViemChainGateway(config?: Partial<GatewayConfig>): ChainGateway {
  const runtime = getRuntimeEnv();
  const rpcUrl = config?.rpcUrl ?? runtime.SEPOLIA_RPC_URL;
  const rawFactoryAddress =
    config?.factoryAddress ?? runtime.ESCROW_FACTORY_ADDRESS ?? freelanceShieldContracts.escrowFactory;
  const relayerPrivateKey = config?.relayerPrivateKey ?? runtime.CHAIN_RELAYER_PRIVATE_KEY;
  if (!rpcUrl) throw new ApiError(503, "SEPOLIA_RPC_URL is not configured", "chain_not_configured");
  if (!rawFactoryAddress || !isAddress(rawFactoryAddress)) {
    throw new ApiError(503, "ESCROW_FACTORY_ADDRESS is not configured", "chain_not_configured");
  }
  const factoryAddress = getAddress(rawFactoryAddress);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  return {
    async deployEscrow(input) {
      if (!relayerPrivateKey) {
        throw new ApiError(503, "CHAIN_RELAYER_PRIVATE_KEY is required to deploy an escrow", "relayer_not_configured");
      }
      const account = privateKeyToAccount(relayerPrivateKey);
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      const { request } = await publicClient.simulateContract({
        account,
        address: factoryAddress,
        abi: factoryAbi,
        functionName: "createEscrow",
        args: [
          input.client,
          input.freelancer,
          input.arbiter,
          input.feeAmountWei,
          input.milestoneAmountsWei,
        ],
      });
      const transactionHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") throw new Error("EscrowFactory transaction reverted");
      const [created] = parseEventLogs({
        abi: factoryAbi,
        eventName: "EscrowCreated",
        logs: receipt.logs,
        strict: true,
      });
      if (!created) throw new Error("EscrowFactory receipt did not contain EscrowCreated");
      return { escrowAddress: getAddress(created.args.escrow), transactionHash };
    },

    async prepareMilestoneAction(input) {
      const functionName = transactionFunction(input.action);
      const args = transactionArgs(input.action, input.milestonePosition, input.deliverableHash);
      await publicClient.simulateContract({
        account: input.actor,
        address: input.escrowAddress,
        abi: escrowAbi,
        functionName,
        args,
      });
      return {
        chainId: sepolia.id,
        from: input.actor,
        to: input.escrowAddress,
        data: encodeFunctionData({ abi: escrowAbi, functionName, args }),
        value: "0",
      };
    },

    async confirmMilestoneAction(input) {
      const [transaction, receipt] = await Promise.all([
        publicClient.getTransaction({ hash: input.transactionHash }),
        publicClient.waitForTransactionReceipt({ hash: input.transactionHash }),
      ]);
      if (receipt.status !== "success") throw new ApiError(409, "The transaction reverted", "transaction_reverted");
      if (getAddress(transaction.from) !== getAddress(input.actor)) {
        throw new ApiError(409, "The transaction signer does not match the authenticated wallet", "transaction_mismatch");
      }
      if (!transaction.to || getAddress(transaction.to) !== getAddress(input.escrowAddress)) {
        throw new ApiError(409, "The transaction target does not match this escrow", "transaction_mismatch");
      }
      const decoded = decodeFunctionData({ abi: escrowAbi, data: transaction.input });
      if (decoded.functionName !== transactionFunction(input.action)) {
        throw new ApiError(409, "The transaction action does not match the request", "transaction_mismatch");
      }
      const decodedPosition = Number(decoded.args[0]);
      if (decodedPosition !== input.milestonePosition) {
        throw new ApiError(409, "The transaction milestone does not match the request", "transaction_mismatch");
      }
      if (input.action === "submit" && decoded.args[1] !== input.deliverableHash) {
        throw new ApiError(409, "The submitted deliverable hash does not match the request", "transaction_mismatch");
      }
      return readEscrow(publicClient, input);
    },

    readEscrow(input) {
      return readEscrow(publicClient, input);
    },
  };
}

async function readEscrow(
  publicClient: PublicClient,
  input: { escrowAddress: Address; client: Address; freelancer: Address },
): Promise<EscrowSnapshot> {
  const common = { address: input.escrowAddress, abi: escrowAbi } as const;
  const [
    funded,
    completed,
    hadDispute,
    requiredFunding,
    remainingMilestones,
    milestoneCount,
    clientWithdrawable,
    freelancerWithdrawable,
    contractBalance,
    blockNumber,
  ] = await Promise.all([
    publicClient.readContract({ ...common, functionName: "funded" }),
    publicClient.readContract({ ...common, functionName: "completed" }),
    publicClient.readContract({ ...common, functionName: "hadDispute" }),
    publicClient.readContract({ ...common, functionName: "requiredFunding" }),
    publicClient.readContract({ ...common, functionName: "remainingMilestones" }),
    publicClient.readContract({ ...common, functionName: "milestoneCount" }),
    publicClient.readContract({ ...common, functionName: "withdrawable", args: [input.client] }),
    publicClient.readContract({ ...common, functionName: "withdrawable", args: [input.freelancer] }),
    publicClient.getBalance({ address: input.escrowAddress }),
    publicClient.getBlockNumber(),
  ]);
  const chainMilestones = await Promise.all(
    Array.from({ length: Number(milestoneCount) }, async (_, position) => {
      const milestone = await publicClient.readContract({
        ...common,
        functionName: "getMilestone",
        args: [BigInt(position)],
      });
      const status = statusNames[Number(milestone.status)];
      if (!status) throw new Error(`Unknown on-chain milestone status: ${milestone.status}`);
      return {
        position,
        amountWei: milestone.amount.toString(),
        status,
        deliverableHash: milestone.deliverableHash,
      };
    }),
  );
  return {
    address: input.escrowAddress,
    funded,
    completed,
    hadDispute,
    requiredFundingWei: requiredFunding.toString(),
    contractBalanceWei: contractBalance.toString(),
    clientWithdrawableWei: clientWithdrawable.toString(),
    freelancerWithdrawableWei: freelancerWithdrawable.toString(),
    remainingMilestones: Number(remainingMilestones),
    lastBlockNumber: blockNumber.toString(),
    milestones: chainMilestones,
  };
}
