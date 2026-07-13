import { advanceDay, publishFallbackDay } from "../_shared/application/day-cycle.ts";
import { isAuthorizedInternalRequest } from "../_shared/infrastructure/internal-auth.ts";
import { SupabaseRpcDatabase } from "../_shared/infrastructure/supabase-rpc.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

export async function handleDayLifecycle(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  try {
    if (!isAuthorizedInternalRequest(request, requiredEnvironment("INTERNAL_FUNCTION_SECRET"))) {
      return Response.json({ status: "unauthorized" }, { status: 401 });
    }
    const database = new SupabaseRpcDatabase(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const at = new Date().toISOString();
    const published = await publishFallbackDay(database, at);
    const advanced = await advanceDay(database, at);
    if (
      !["applied", "cached", "ok"].includes(published.status) ||
      !["applied", "cached", "ok"].includes(advanced.status)
    ) return Response.json({ status: "rejected" }, { status: 409 });
    return Response.json({ status: "ok", published, advanced });
  } catch {
    return Response.json({ status: "error" }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve(handleDayLifecycle);
