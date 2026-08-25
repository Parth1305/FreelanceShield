import { authenticateRequest, publicUser } from "@/server/auth";
import { ApiError, errorResponse } from "@/server/http";
import { DrizzleProjectRepository } from "@/server/project-repository";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const user = await new DrizzleProjectRepository().findUserById(actor.id);
    if (!user) throw new ApiError(401, "The authenticated user no longer exists", "invalid_token");
    return Response.json({ user: publicUser(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
