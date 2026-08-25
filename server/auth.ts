import { compare, hash } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import type { User } from "@/db/schema";
import { ApiError } from "./http";

const JWT_ISSUER = "freelance-shield";
const JWT_AUDIENCE = "freelance-shield-api";
const TOKEN_TTL = "7d";

export type AuthenticatedUser = Pick<User, "id" | "email" | "role" | "walletAddress">;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeWalletAddress(value?: string | null): Address | null {
  if (!value) return null;
  if (!isAddress(value)) throw new ApiError(400, "walletAddress must be a valid EVM address", "invalid_wallet");
  return getAddress(value);
}

export function validatePassword(password: string): void {
  if (password.length < 10 || password.length > 128) {
    throw new ApiError(400, "Password must contain between 10 and 128 characters", "invalid_password");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  return hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

async function jwtKey(secret?: string): Promise<Uint8Array> {
  const resolved = secret ?? (await import("./runtime-env")).requireRuntimeValue("JWT_SECRET");
  if (resolved.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(resolved);
}

export async function issueAccessToken(user: AuthenticatedUser, secret?: string): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role, walletAddress: user.walletAddress })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(await jwtKey(secret));
}

export async function verifyAccessToken(token: string, secret?: string): Promise<AuthenticatedUser> {
  try {
    const { payload } = await jwtVerify(token, await jwtKey(secret), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (!payload.sub || typeof payload.email !== "string") throw new Error("Missing token claims");
    if (payload.role !== "client" && payload.role !== "freelancer" && payload.role !== "both") {
      throw new Error("Invalid role claim");
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      walletAddress: typeof payload.walletAddress === "string" ? payload.walletAddress : null,
    };
  } catch {
    throw new ApiError(401, "The access token is invalid or expired", "invalid_token");
  }
}

export async function authenticateRequest(request: Request): Promise<AuthenticatedUser> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "A Bearer access token is required", "authentication_required");
  }
  return verifyAccessToken(authorization.slice(7).trim());
}

export function publicUser(user: User | AuthenticatedUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    walletAddress: user.walletAddress,
  };
}
