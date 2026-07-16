import { assertEquals } from "jsr:@std/assert@1.0.19";
import {
  createRuntimeHandlerDependencies,
  createTelegramWebhookHandler,
  type TelegramWebhookBoundaryDependencies,
} from "../../supabase/functions/tg-webhook/index.ts";
import type { TelegramHandlerDependencies } from "../../supabase/functions/_shared/telegram/handler.ts";
import type { NormalizedTelegramUpdate } from "../../supabase/functions/_shared/telegram/update.ts";

const ownerUpdate: NormalizedTelegramUpdate = {
  kind: "command",
  updateId: 700000010n,
  telegramExternalId: 900000010n,
  chatId: 900000010n,
  messageId: 50n,
  command: "start",
  argument: "",
};

function request(secret = "synthetic-webhook-secret"): Request {
  return new Request("http://127.0.0.1/tg-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: "synthetic-body",
  });
}

function dependencies(input: {
  readonly events: string[];
  readonly secretAccepted?: boolean;
  readonly owner?: string;
  readonly normalized?: NormalizedTelegramUpdate;
  readonly bounded?: boolean;
  readonly adapterError?: string;
}): TelegramWebhookBoundaryDependencies {
  return {
    getEnvironment(name) {
      input.events.push(`environment:${name}`);
      if (name === "TELEGRAM_WEBHOOK_SECRET") return "synthetic-webhook-secret";
      if (name === "TELEGRAM_OWNER_EXTERNAL_ID") return input.owner ?? "900000010";
      return undefined;
    },
    verifySecret: () => {
      input.events.push("verify-secret");
      return Promise.resolve(input.secretAccepted ?? true);
    },
    readBody: () => {
      input.events.push("read-body");
      return Promise.resolve(
        input.bounded === false
          ? { ok: false as const }
          : { ok: true as const, body: "synthetic-body" },
      );
    },
    normalizeBody: () => {
      input.events.push("normalize-body");
      return input.normalized ?? ownerUpdate;
    },
    createHandlerDependencies: () => {
      input.events.push("construct-privileged-adapters");
      if (input.adapterError) throw new Error(input.adapterError);
      return {} as TelegramHandlerDependencies;
    },
    handleUpdate: () => {
      input.events.push("handle-update");
      return Promise.resolve({ statusCode: 200 as const, route: "synthetic-route" });
    },
  };
}

Deno.test("webhook verifies its secret before body access", async () => {
  const events: string[] = [];
  const handler = createTelegramWebhookHandler(dependencies({ events, secretAccepted: false }));
  const response = await handler(request("attacker-secret"));
  assertEquals(response.status, 401);
  assertEquals(events, ["environment:TELEGRAM_WEBHOOK_SECRET", "verify-secret"]);
  const body = await response.text();
  assertEquals(body.includes("attacker-secret"), false);
  assertEquals(body.includes("synthetic-webhook-secret"), false);
});

Deno.test("webhook bounds and normalizes before owner check, then rejects before adapters", async () => {
  const events: string[] = [];
  const handler = createTelegramWebhookHandler(dependencies({
    events,
    normalized: { ...ownerUpdate, telegramExternalId: 900000011n, chatId: 900000011n },
  }));
  const response = await handler(request());
  assertEquals(response.status, 403);
  assertEquals(events, [
    "environment:TELEGRAM_WEBHOOK_SECRET",
    "verify-secret",
    "read-body",
    "normalize-body",
    "environment:TELEGRAM_OWNER_EXTERNAL_ID",
  ]);
  const body = await response.text();
  assertEquals(body.includes("900000010"), false);
  assertEquals(body.includes("900000011"), false);
});

Deno.test("webhook constructs privileged adapters only for the configured owner", async () => {
  const events: string[] = [];
  const handler = createTelegramWebhookHandler(dependencies({ events }));
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "ok", route: "synthetic-route" });
  assertEquals(events, [
    "environment:TELEGRAM_WEBHOOK_SECRET",
    "verify-secret",
    "read-body",
    "normalize-body",
    "environment:TELEGRAM_OWNER_EXTERNAL_ID",
    "construct-privileged-adapters",
    "handle-update",
  ]);
});

Deno.test("webhook fails closed on oversized bodies or invalid owner configuration", async () => {
  const oversizedEvents: string[] = [];
  const oversized = createTelegramWebhookHandler(dependencies({
    events: oversizedEvents,
    bounded: false,
  }));
  assertEquals((await oversized(request())).status, 413);
  assertEquals(oversizedEvents, [
    "environment:TELEGRAM_WEBHOOK_SECRET",
    "verify-secret",
    "read-body",
  ]);

  const invalidEvents: string[] = [];
  const invalid = createTelegramWebhookHandler(dependencies({
    events: invalidEvents,
    owner: "900000010,900000011",
  }));
  const response = await invalid(request());
  assertEquals(response.status, 500);
  assertEquals(invalidEvents.includes("construct-privileged-adapters"), false);
  const body = await response.text();
  assertEquals(body.includes("900000010"), false);
  assertEquals(body.includes("900000011"), false);
});

Deno.test("webhook never exposes privileged credential failures", async () => {
  const events: string[] = [];
  const secrets = [
    "synthetic-bot-token-value",
    "synthetic-service-role-value",
    "synthetic-callback-key-value",
  ];
  const handler = createTelegramWebhookHandler(dependencies({
    events,
    adapterError: secrets.join(":"),
  }));
  const response = await handler(request());
  assertEquals(response.status, 500);
  const body = await response.text();
  for (const secret of secrets) assertEquals(body.includes(secret), false);
  assertEquals(events.includes("handle-update"), false);
});

Deno.test("owner runtime enables deletion only with an isolated recovery adapter", async () => {
  const environmentReads: string[] = [];
  const values: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-primary-service-key",
    TELEGRAM_BOT_TOKEN: "123456789:" + "x".repeat(35),
    RECOVERY_SUPABASE_URL: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co",
    RECOVERY_SUPABASE_SERVICE_ROLE_KEY: "synthetic-recovery-service-key",
    TELEGRAM_CALLBACK_HMAC_KEY: "synthetic-callback-key",
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const runtime = createRuntimeHandlerDependencies(
    (name) => {
      environmentReads.push(name);
      return values[name];
    },
    (input, init) => {
      requests.push({ url: String(input), init });
      return Promise.resolve(Response.json({ status: "applied" }));
    },
  );

  assertEquals(runtime.deletionEnabled, true);
  assertEquals(environmentReads, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "RECOVERY_SUPABASE_URL",
    "RECOVERY_SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_CALLBACK_HMAC_KEY",
  ]);
  await runtime.deletionSink.recordTombstone({
    surrogatePlayerId: "60000000-0000-4000-8000-000000000084",
    deletionId: "61000000-0000-5000-8000-000000000084",
    recordedAt: "2026-07-16T12:10:00.000Z",
  });
  assertEquals(requests.length, 1);
  assertEquals(
    requests[0]?.url,
    "https://bbbbbbbbbbbbbbbbbbbb.supabase.co/rest/v1/rpc/record_deletion_tombstone_v1",
  );
});
