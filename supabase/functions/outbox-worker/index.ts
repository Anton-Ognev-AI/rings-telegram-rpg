import { processOutboxBatch } from "../_shared/application/process-outbox.ts";
import { isAuthorizedInternalRequest } from "../_shared/infrastructure/internal-auth.ts";
import { SupabaseRpcDatabase } from "../_shared/infrastructure/supabase-rpc.ts";
import { TelegramBotApiPort } from "../_shared/telegram/http.ts";

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

export async function handleOutbox(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  try {
    if (!isAuthorizedInternalRequest(request, requiredEnvironment("INTERNAL_FUNCTION_SECRET"))) {
      return Response.json({ status: "unauthorized" }, { status: 401 });
    }
    const result = await processOutboxBatch({
      database: new SupabaseRpcDatabase(
        requiredEnvironment("SUPABASE_URL"),
        requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      ),
      telegram: new TelegramBotApiPort(requiredEnvironment("TELEGRAM_BOT_TOKEN")),
      clock: { now: () => new Date() },
      callbackKey: new TextEncoder().encode(requiredEnvironment("TELEGRAM_CALLBACK_HMAC_KEY")),
    }, {
      workerId: crypto.randomUUID(),
      limit: 10,
      leaseSeconds: 30,
    });
    return Response.json({ status: "ok", ...result });
  } catch {
    return Response.json({ status: "error" }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve(handleOutbox);
