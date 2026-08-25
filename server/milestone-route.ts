import type { MilestoneAction } from "./project-types";
import { authenticateRequest } from "./auth";
import { createViemChainGateway } from "./chain-gateway";
import { errorResponse, readJson } from "./http";
import { DrizzleProjectRepository } from "./project-repository";
import { ProjectService } from "./project-service";
import type { MilestoneActionPayload } from "./project-service";

type RouteContext = { params: Promise<{ projectId: string; milestoneId: string }> };

export async function handleMilestoneAction(request: Request, context: RouteContext, action: MilestoneAction) {
  try {
    const actor = await authenticateRequest(request);
    const payload = await readJson<MilestoneActionPayload>(request);
    const { projectId, milestoneId } = await context.params;
    const service = new ProjectService(new DrizzleProjectRepository(), createViemChainGateway());
    return Response.json({ result: await service.milestoneAction(actor, projectId, milestoneId, action, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
