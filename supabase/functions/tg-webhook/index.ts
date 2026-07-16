import { SupabaseRecoveryDeletionSink } from "../_shared/infrastructure/recovery-supabase.ts";
import { type FetchPort, SupabaseRpcDatabase } from "../_shared/infrastructure/supabase-rpc.ts";
import { handleTelegramUpdate } from "../_shared/telegram/handler.ts";
import { TelegramBotApiPort } from "../_shared/telegram/http.ts";
import { assertOwnerAllowed, OwnerAllowlistError } from "../_shared/telegram/owner-allowlist.ts";
import { verifyTelegramSecret } from "../_shared/telegram/security.ts";
import {
  type NormalizedTelegramUpdate,
  normalizeTelegramUpdate,
  TelegramUpdateError,
} from "../_shared/telegram/update.ts";
import type {
  TelegramHandlerDependencies,
  TelegramHandlerResult,
} from "../_shared/telegram/handler.ts";

const MAX_UPDATE_BYTES = 64 * 1024;

function requiredEnvironment(
  getEnvironment: (name: string) => string | undefined,
  name: string,
): string {
  const value = getEnvironment(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

export type BoundedWebhookBody =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false };

async function readBoundedWebhookBody(request: Request): Promise<BoundedWebhookBody> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPDATE_BYTES) {
    return { ok: false };
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_UPDATE_BYTES) {
    return { ok: false };
  }
  return { ok: true, body };
}

function normalizeBody(body: string): NormalizedTelegramUpdate {
  return normalizeTelegramUpdate(JSON.parse(body));
}

export interface TelegramWebhookBoundaryDependencies {
  readonly getEnvironment: (name: string) => string | undefined;
  readonly verifySecret: (request: Request, expected: string) => Promise<boolean>;
  readonly readBody: (request: Request) => Promise<BoundedWebhookBody>;
  readonly normalizeBody: (body: string) => NormalizedTelegramUpdate;
  readonly createHandlerDependencies: () => TelegramHandlerDependencies;
  readonly handleUpdate: (
    dependencies: TelegramHandlerDependencies,
    update: NormalizedTelegramUpdate,
  ) => Promise<TelegramHandlerResult>;
}

export function createTelegramWebhookHandler(
  dependencies: TelegramWebhookBoundaryDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      const webhookSecret = requiredEnvironment(
        dependencies.getEnvironment,
        "TELEGRAM_WEBHOOK_SECRET",
      );
      if (!await dependencies.verifySecret(request, webhookSecret)) {
        return Response.json({ status: "unauthorized" }, { status: 401 });
      }

      const boundedBody = await dependencies.readBody(request);
      if (!boundedBody.ok) {
        return Response.json({ status: "too_large" }, { status: 413 });
      }

      let normalized: NormalizedTelegramUpdate;
      try {
        normalized = dependencies.normalizeBody(boundedBody.body);
      } catch (error) {
        if (error instanceof TelegramUpdateError || error instanceof SyntaxError) {
          return Response.json({ status: "malformed" }, { status: 400 });
        }
        throw error;
      }

      const expectedOwner = requiredEnvironment(
        dependencies.getEnvironment,
        "TELEGRAM_OWNER_EXTERNAL_ID",
      );
      try {
        assertOwnerAllowed(normalized, expectedOwner);
      } catch (error) {
        if (error instanceof OwnerAllowlistError && error.code === "owner_not_allowed") {
          return Response.json({ status: "forbidden" }, { status: 403 });
        }
        throw error;
      }

      const result = await dependencies.handleUpdate(
        dependencies.createHandlerDependencies(),
        normalized,
      );
      return Response.json({ status: "ok", route: result.route }, { status: result.statusCode });
    } catch {
      return Response.json({ status: "error" }, { status: 500 });
    }
  };
}

const getEnvironment = (name: string) => Deno.env.get(name);

export function createRuntimeHandlerDependencies(
  environment: (name: string) => string | undefined,
  fetcher: FetchPort = fetch,
): TelegramHandlerDependencies {
  return {
    database: new SupabaseRpcDatabase(
      requiredEnvironment(environment, "SUPABASE_URL"),
      requiredEnvironment(environment, "SUPABASE_SERVICE_ROLE_KEY"),
      fetcher,
    ),
    telegram: new TelegramBotApiPort(
      requiredEnvironment(environment, "TELEGRAM_BOT_TOKEN"),
      fetcher,
    ),
    clock: { now: () => new Date() },
    deletionSink: new SupabaseRecoveryDeletionSink(
      requiredEnvironment(environment, "RECOVERY_SUPABASE_URL"),
      requiredEnvironment(environment, "RECOVERY_SUPABASE_SERVICE_ROLE_KEY"),
      fetcher,
    ),
    deletionEnabled: true,
    callbackKey: new TextEncoder().encode(
      requiredEnvironment(environment, "TELEGRAM_CALLBACK_HMAC_KEY"),
    ),
  };
}

export const handleWebhook = createTelegramWebhookHandler({
  getEnvironment,
  verifySecret: verifyTelegramSecret,
  readBody: readBoundedWebhookBody,
  normalizeBody,
  createHandlerDependencies: () => createRuntimeHandlerDependencies(getEnvironment),
  handleUpdate: handleTelegramUpdate,
});

if (import.meta.main) Deno.serve(handleWebhook);
