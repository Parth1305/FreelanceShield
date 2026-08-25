import { env } from "cloudflare:workers";
import type { Address, Hex } from "viem";

export type RuntimeEnv = {
  DB: unknown;
  JWT_SECRET?: string;
  SEPOLIA_RPC_URL?: string;
  CHAIN_RELAYER_PRIVATE_KEY?: Hex;
  ESCROW_FACTORY_ADDRESS?: Address;
};

export function getRuntimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function requireRuntimeValue<K extends keyof RuntimeEnv>(name: K): NonNullable<RuntimeEnv[K]> {
  const value = getRuntimeEnv()[name];
  if (!value) throw new Error(`${String(name)} is not configured`);
  return value as NonNullable<RuntimeEnv[K]>;
}
