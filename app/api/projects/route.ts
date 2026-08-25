import { authenticateRequest } from "@/server/auth";
import { createViemChainGateway } from "@/server/chain-gateway";
import { errorResponse, readJson } from "@/server/http";
import { DrizzleProjectRepository } from "@/server/project-repository";
import { ProjectService } from "@/server/project-service";
import type { CreateProjectPayload } from "@/server/project-service";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const projects = await new DrizzleProjectRepository().listProjectsForUser(actor.id);
    return Response.json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const payload = await readJson<CreateProjectPayload>(request);
    const service = new ProjectService(new DrizzleProjectRepository(), createViemChainGateway());
    return Response.json({ project: await service.createProject(actor, payload) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
