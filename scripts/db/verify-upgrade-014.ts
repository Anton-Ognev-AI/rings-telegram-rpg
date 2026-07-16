import { withDatabase } from "./local-database.ts";

const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const LOCKED_014_SHA256 = "66d42b4b3c00f47f294d70e5f316f8430810b877d0d25f03006b356bc6f7a713";

interface UpgradeFixture {
  readonly unknownOutboxId: string;
  readonly unknownIncidentId: string;
  readonly currentPlayerId: string;
  readonly currentRunId: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runNpm(args: readonly string[], environment: Readonly<Record<string, string>>) {
  const status = await new Deno.Command(npm, {
    args: [...args],
    cwd: Deno.cwd(),
    env: { ...environment },
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) throw new Error(`upgrade_014_command_failed:${args.join(":")}`);
}

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>) {
  const [row] = await statement;
  return (row as { response: Record<string, unknown> }).response;
}

async function seedMigration014Fixture(): Promise<UpgradeFixture> {
  return await withDatabase(async (sql) => {
    const at = "2026-09-20T07:00:00Z";
    await rpc(sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
    await rpc(sql`select public.advance_day_v2(${at}::timestamptz) as response`);

    const unknownIdentity = await rpc(sql`
      select public.telegram_identity_v2(970000000000000001::bigint, true) as response
    `);
    const unknownStarted = await rpc(sql`select public.start_run_v3(
      ${String(unknownIdentity.playerId)}::uuid, ${at}::timestamptz
    ) as response`);
    const unknownRunId = String(
      (unknownStarted.projection as { run: { id: string } }).run.id,
    );
    const [unknownOutbox] = await sql<{ id: string }[]>`select id::text
      from game.outbox_messages
      where status = 'pending' and payload->>'runId' = ${unknownRunId}
      order by created_at desc limit 1`;
    const unknownIncidentId = "97100000-0000-4000-8000-000000000001";
    await sql`update game.outbox_messages set
      status = 'delivery_unknown',
      leased_by = '97200000-0000-4000-8000-000000000001'::uuid,
      lease_id = ${unknownIncidentId}::uuid,
      lease_until = null,
      attempts = 1,
      dispatch_started_at = ${at}::timestamptz + interval '1 second',
      last_error_kind = 'delivery_unknown'
      where id = ${unknownOutbox.id}::uuid`;

    const currentIdentity = await rpc(sql`
      select public.telegram_identity_v2(970000000000000002::bigint, true) as response
    `);
    const currentPlayerId = String(currentIdentity.playerId);
    const currentStarted = await rpc(sql`select public.start_run_v3(
      ${currentPlayerId}::uuid, ${at}::timestamptz
    ) as response`);
    const currentRunId = String(
      (currentStarted.projection as { run: { id: string } }).run.id,
    );
    await sql`update game.outbox_messages set status = 'sent'
      where status = 'pending' and payload->>'runId' = ${currentRunId}`;
    await sql`insert into game.telegram_run_cards(
      run_id, player_id, message_id, last_state_version
    ) values (${currentRunId}::uuid, ${currentPlayerId}::uuid, 870000000000000002, 0)`;

    return {
      unknownOutboxId: unknownOutbox.id,
      unknownIncidentId,
      currentPlayerId,
      currentRunId,
    };
  });
}

async function verifyUpgrade(fixture: UpgradeFixture): Promise<void> {
  await withDatabase(async (sql) => {
    const [preserved] = await sql<{ status: string; lease_id: string; players: number }[]>`select
      o.status::text,
      o.lease_id::text,
      (select count(*)::integer from game.players
        where id in (
          (select player_id from game.runs where id = ${fixture.currentRunId}::uuid),
          (select r.player_id from game.outbox_messages x join game.runs r
            on r.id = (x.payload->>'runId')::uuid where x.id = ${fixture.unknownOutboxId}::uuid)
        )) as players
      from game.outbox_messages o where o.id = ${fixture.unknownOutboxId}::uuid`;
    if (
      preserved.status !== "delivery_unknown" ||
      preserved.lease_id !== fixture.unknownIncidentId ||
      preserved.players !== 2
    ) throw new Error("upgrade_014_state_changed");

    const reconciled = await rpc(sql`select public.reconcile_delivery_unknown_v1(
      ${fixture.unknownOutboxId}::uuid,
      ${fixture.unknownIncidentId}::uuid,
      'confirm_not_delivered_and_requeue', null,
      '2026-09-20T07:00:02Z'::timestamptz
    ) as response`);
    if (reconciled.status !== "applied" || reconciled.outcome !== "requeued") {
      throw new Error("upgrade_014_reconciliation_unavailable");
    }

    const current = await rpc(sql`select public.request_run_render_v2(
      ${fixture.currentPlayerId}::uuid, ${fixture.currentRunId}::uuid
    ) as response`);
    if (current.status !== "cached" || current.reason !== "card_current") {
      throw new Error("upgrade_014_current_card_cache_unavailable");
    }
    const [repairs] = await sql<{ count: number }[]>`select count(*)::integer
      from game.outbox_messages
      where intent_type = 'repair_run_state' and payload->>'runId' = ${fixture.currentRunId}`;
    if (repairs.count !== 0) throw new Error("upgrade_014_redundant_repair_created");
  });
}

async function main(): Promise<void> {
  if (await pathExists("supabase/.temp/project-ref")) {
    throw new Error("upgrade_014_remote_supabase_link_forbidden");
  }
  if (Deno.env.get("ALLOW_REMOTE_TEST_DB")?.trim()) {
    throw new Error("upgrade_014_remote_database_override_forbidden");
  }
  if (
    await sha256File("supabase/migrations/202607150014_tutorial_starter.sql") !==
      LOCKED_014_SHA256
  ) throw new Error("upgrade_014_locked_migration_changed");

  const profile = await Deno.makeTempDir({ prefix: "tggame-upgrade-014-" });
  const environment = {
    ...Deno.env.toObject(),
    HOME: profile,
    USERPROFILE: profile,
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  let failure: unknown;
  try {
    console.log("[upgrade-014 1/5] reset through migration 014");
    await runNpm([
      "run",
      "supabase",
      "--",
      "db",
      "reset",
      "--version",
      "202607150014",
      "--local",
    ], environment);
    console.log("[upgrade-014 2/5] seed canonical fallback content");
    await runNpm([
      "run",
      "deno",
      "--",
      "run",
      "--allow-env",
      "--allow-net",
      "scripts/db/seed-content.ts",
    ], environment);
    console.log("[upgrade-014 3/5] seed migration-014 delivery and card state");
    const fixture = await seedMigration014Fixture();
    console.log("[upgrade-014 4/5] apply migrations 015 and 016 in place");
    await runNpm(["run", "supabase", "--", "migration", "up", "--local"], environment);
    console.log("[upgrade-014 5/5] verify preservation and new contracts");
    await verifyUpgrade(fixture);
  } catch (error) {
    failure = error;
  } finally {
    console.log("[upgrade-014 cleanup] restore the full local schema");
    try {
      await runNpm(["run", "db:reset"], environment);
    } catch (error) {
      failure ??= error;
    }
    await Deno.remove(profile, { recursive: true }).catch(() => undefined);
  }
  if (failure) throw failure;
}

if (import.meta.main) await main();
