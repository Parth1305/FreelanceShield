import type { Address, Hex } from "viem";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      JWT_SECRET?: string;
      SEPOLIA_RPC_URL?: string;
      CHAIN_RELAYER_PRIVATE_KEY?: Hex;
      ESCROW_FACTORY_ADDRESS?: Address;
    }
  }
}

export {};
