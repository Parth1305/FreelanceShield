import { isEmail } from "@/server/validation";
import {
  hashPassword,
  issueAccessToken,
  normalizeEmail,
  normalizeWalletAddress,
  publicUser,
} from "@/server/auth";
import { ApiError, errorResponse, readJson } from "@/server/http";
import { DrizzleProjectRepository } from "@/server/project-repository";

type RegisterPayload = {
  email?: string;
  password?: string;
  role?: "client" | "freelancer" | "both";
  walletAddress?: string;
};

export async function POST(request: Request) {
  try {
    const payload = await readJson<RegisterPayload>(request);
    const email = normalizeEmail(payload.email ?? "");
    if (!isEmail(email)) throw new ApiError(400, "A valid email is required", "invalid_email");
    if (!payload.password) throw new ApiError(400, "password is required", "invalid_password");
    const role = payload.role ?? "both";
    if (role !== "client" && role !== "freelancer" && role !== "both") {
      throw new ApiError(400, "role must be client, freelancer, or both", "invalid_role");
    }
    const repository = new DrizzleProjectRepository();
    if (await repository.findUserByEmail(email)) {
      throw new ApiError(409, "An account already uses that email", "email_in_use");
    }
    let user;
    try {
      user = await repository.createUser({
        id: crypto.randomUUID(),
        email,
        passwordHash: await hashPassword(payload.password),
        role,
        walletAddress: normalizeWalletAddress(payload.walletAddress),
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
        throw new ApiError(409, "That email or wallet is already registered", "account_in_use");
      }
      throw error;
    }
    const safeUser = publicUser(user);
    return Response.json({ user: safeUser, accessToken: await issueAccessToken(safeUser) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
