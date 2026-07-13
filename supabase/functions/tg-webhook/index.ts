import type { IdentityDeletionSink } from "../_shared/application/delete-identity.ts";
import { SupabaseRpcDatabase } from "../_shared/infrastructure/supabase-rpc.ts";
import { handleTelegramUpdate } from "../_shared/telegram/handler.ts";
import { TelegramBotApiPort } from "../_shared/telegram/http.ts";
import { verifyTelegramSecret } from "../_shared/telegram/security.ts";
import { normalizeTelegramUpdate, TelegramUpdateError } from "../_shared/telegram/update.ts";

const MAX_UPDATE_BYTES = 64 * 1024;

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

const pendingDeletionSink: IdentityDeletionSink = {
  recordTombstone: () => Promise.reject(new Error("deletion_sink_not_configured")),
};

async function handleWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const webhookSecret = requiredEnvironment("TELEGRAM_WEBHOOK_SECRET");
  if (!await verifyTelegramSecret(request, webhookSecret)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPDATE_BYTES) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_UPDATE_BYTES) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }

  let normalized;
  try {
    normalized = normalizeTelegramUpdate(JSON.parse(body));
  } catch (error) {
    if (error instanceof TelegramUpdateError || error instanceof SyntaxError) {
      return Response.json({ status: "malformed" }, { status: 400 });
    }
    return Response.json({ status: "error" }, { status: 500 });
  }

  try {
    const database = new SupabaseRpcDatabase(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const result = await handleTelegramUpdate({
      database,
      telegram: new TelegramBotApiPort(requiredEnvironment("TELEGRAM_BOT_TOKEN")),
      clock: { now: () => new Date() },
      deletionSink: pendingDeletionSink,
      deletionEnabled: false,
      callbackKey: new TextEncoder().encode(requiredEnvironment("TELEGRAM_CALLBACK_HMAC_KEY")),
    }, normalized);
    return Response.json({ status: "ok", route: result.route }, { status: result.statusCode });
  } catch {
    return Response.json({ status: "error" }, { status: 500 });
  }
}

Deno.serve(handleWebhook);
