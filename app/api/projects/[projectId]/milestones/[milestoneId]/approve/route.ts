import { handleMilestoneAction } from "@/server/milestone-route";

type RouteContext = { params: Promise<{ projectId: string; milestoneId: string }> };

export function POST(request: Request, context: RouteContext) {
  return handleMilestoneAction(request, context, "approve");
}
