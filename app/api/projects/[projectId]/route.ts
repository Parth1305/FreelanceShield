import { authenticateRequest } from "@/server/auth";
import { createViemChainGateway } from "@/server/chain-gateway";
import { errorResponse } from "@/server/http";
import { DrizzleProjectRepository } from "@/server/project-repository";
import { ProjectService } from "@/server/project-service";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await authenticateRequest(request);
    const { projectId } = await context.params;
    const service = new ProjectService(new DrizzleProjectRepository(), createViemChainGateway());
    return Response.json({ project: await service.getProject(actor, projectId) });
  } catch (error) {
    return errorResponse(error);
  }
}
