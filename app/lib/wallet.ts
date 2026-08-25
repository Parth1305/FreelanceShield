import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  isAddress,
  parseAbi,
} from "viem";
import type { Address, EIP1193Provider, Hex } from "viem";
import { sepolia } from "viem/chains";
import { freelanceShieldContracts } from "./contracts.generated";
import type { PreparedTransaction } from "./frontend-api";

const escrowAbi = parseAbi(["function fund() payable"]);
const reputationAbi = parseAbi([
  "function scoreOf(address account) view returns (uint256)",
  "function getReputation(address account) view returns ((uint32 completedContracts, uint32 disputesOpened, uint32 disputesWon, uint32 disputesLost))",
]);

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean };
  }
}

function provider(): EIP1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask is not available in this browser");
  }
  return window.ethereum;
}

async function clients() {
  const transport = custom(provider());
  const walletClient = createWalletClient({ chain: sepolia, transport });
  const publicClient = createPublicClient({ chain: sepolia, transport });
  try {
    await walletClient.switchChain({ id: sepolia.id });
  } catch {
    try {
      await walletClient.addChain({ chain: sepolia });
      await walletClient.switchChain({ id: sepolia.id });
    } catch {
      throw new Error("Add or switch MetaMask to the Sepolia network and try again");
    }
  }
  return { walletClient, publicClient };
}

export async function connectMetaMask(): Promise<Address> {
  const { walletClient } = await clients();
  const [address] = await walletClient.requestAddresses();
  if (!address) throw new Error("MetaMask did not return an account");
  return getAddress(address);
}

export function shortAddress(address?: string | null): string {
  if (!address || !isAddress(address)) return "No wallet";
  const normalized = getAddress(address);
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export async function sendPreparedTransaction(
  transaction: PreparedTransaction,
  connectedAddress: Address,
): Promise<Hex> {
  if (getAddress(transaction.from) !== getAddress(connectedAddress)) {
    throw new Error("The connected wallet does not match the account required for this action");
  }
  const { walletClient, publicClient } = await clients();
  const hash = await walletClient.sendTransaction({
    account: connectedAddress,
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The Sepolia transaction reverted");
  return hash;
}

export async function fundEscrow(
  escrowAddress: Address,
  requiredFundingWei: string,
  connectedAddress: Address,
): Promise<Hex> {
  const { walletClient, publicClient } = await clients();
  const hash = await walletClient.writeContract({
    account: connectedAddress,
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "fund",
    value: BigInt(requiredFundingWei),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Escrow funding reverted");
  return hash;
}

export type ReputationView = {
  available: boolean;
  score: number | null;
  completedContracts: number;
  disputesOpened: number;
  disputesWon: number;
  disputesLost: number;
};

export async function readReputation(account: Address): Promise<ReputationView> {
  const registryAddress = freelanceShieldContracts.reputationRegistry;
  if (!registryAddress) {
    return {
      available: false,
      score: null,
      completedContracts: 0,
      disputesOpened: 0,
      disputesWon: 0,
      disputesLost: 0,
    };
  }
  const { publicClient } = await clients();
  const [score, reputation] = await Promise.all([
    publicClient.readContract({
      address: registryAddress,
      abi: reputationAbi,
      functionName: "scoreOf",
      args: [account],
    }),
    publicClient.readContract({
      address: registryAddress,
      abi: reputationAbi,
      functionName: "getReputation",
      args: [account],
    }),
  ]);
  return {
    available: true,
    score: Number(score),
    completedContracts: Number(reputation.completedContracts),
    disputesOpened: Number(reputation.disputesOpened),
    disputesWon: Number(reputation.disputesWon),
    disputesLost: Number(reputation.disputesLost),
  };
}

export function formatEth(value: string | bigint): string {
  const formatted = Number(formatEther(BigInt(value)));
  if (formatted === 0) return "0 ETH";
  return `${formatted.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
}
