import { issueAccessToken, normalizeEmail, publicUser, verifyPassword } from "@/server/auth";
import { ApiError, errorResponse, readJson } from "@/server/http";
import { DrizzleProjectRepository } from "@/server/project-repository";

type LoginPayload = { email?: string; password?: string };

export async function POST(request: Request) {
  try {
    const payload = await readJson<LoginPayload>(request);
    const repository = new DrizzleProjectRepository();
    const user = await repository.findUserByEmail(normalizeEmail(payload.email ?? ""));
    if (!user || !payload.password || !(await verifyPassword(payload.password, user.passwordHash))) {
      throw new ApiError(401, "Email or password is incorrect", "invalid_credentials");
    }
    const safeUser = publicUser(user);
    return Response.json({ user: safeUser, accessToken: await issueAccessToken(safeUser) });
  } catch (error) {
    return errorResponse(error);
  }
}
