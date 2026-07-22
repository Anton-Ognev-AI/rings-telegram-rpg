import { withDatabase } from "./local-database.ts";

const LOCKED_016_SHA256 = "1ce4230c8918fe0f7025a9ee59115594234b95c659e39a8df3b9b0fdd7c3ef19";

interface UpgradeFixture {
  readonly playerId: string;
  readonly runId: string;
  readonly selfSnapshot: Readonly<Record<string, unknown>>;
  readonly loadoutSnapshot: Readonly<Record<string, unknown>>;
  readonly actionToken: string;
  readonly actionContext: string;
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
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function supabaseBinaryCandidates(os: string, arch: string): readonly string[] {
  const executables = os === "windows" ? ["supabase.exe", "supabase-go.exe"] : ["supabase"];
  const platformPackage = os === "windows"
    ? "@supabase/cli-windows-x64/bin"
    : `@supabase/cli-${os}-${arch}/bin`;
  return ["node_modules", "../../node_modules"].flatMap((root) =>
    executables.map((executable) => `${root}/${platformPackage}/${executable}`)
  );
}

async function resolveSupabaseBinary(): Promise<string> {
  for (const candidate of supabaseBinaryCandidates(Deno.build.os, Deno.build.arch)) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error("upgrade_017_supabase_binary_missing");
}

async function runCommand(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
) {
  const status = await new Deno.Command(command, {
    args: [...args],
    cwd: Deno.cwd(),
    env: { ...environment },
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) throw new Error(`upgrade_017_command_failed:${args.join(":")}`);
}

async function rpc(statement: PromiseLike<ReadonlyArray<unknown>>) {
  const [row] = await statement;
  return (row as { response: Record<string, unknown> }).response;
}

async function seedMigration016Fixture(): Promise<UpgradeFixture> {
  return await withDatabase(async (sql) => {
    const at = "2026-09-23T07:00:00Z";
    const identity = await rpc(sql`
      select public.telegram_identity_v2(980000000000000017::bigint, true) as response
    `);
    const playerId = String(identity.playerId);
    await rpc(sql`select public.publish_fallback_day_v1(${at}::timestamptz) as response`);
    await rpc(sql`select public.advance_day_v2(${at}::timestamptz) as response`);
    const started = await rpc(sql`
      select public.start_run_v3(${playerId}::uuid, ${at}::timestamptz) as response
    `);
    const projection = started.projection as {
      run: { id: string };
      selfSnapshot: Readonly<Record<string, unknown>>;
      loadout: Readonly<Record<string, unknown>>;
    };
    const actionToken = "17".repeat(32);
    const actionContext = "71".repeat(32);
    const prepared = await rpc(sql`
      select public.prepare_player_action_v1(
        ${playerId}::uuid, ${actionToken}, 0::bigint, 8017::bigint,
        ${sql.json({ kind: "defer_stat" })}::jsonb, ${actionContext},
        clock_timestamp() + interval '1 hour'
      ) as response
    `);
    if (prepared.status !== "ok") throw new Error("upgrade_017_legacy_action_not_prepared");
    return {
      playerId,
      runId: projection.run.id,
      selfSnapshot: projection.selfSnapshot,
      loadoutSnapshot: projection.loadout,
      actionToken,
      actionContext,
    };
  });
}

async function verifyUpgrade(fixture: UpgradeFixture): Promise<void> {
  await withDatabase(async (sql) => {
    const view = await rpc(sql`
      select public.run_view_v3(${fixture.playerId}::uuid, ${fixture.runId}::uuid) as response
    `) as Record<string, unknown> & {
      selfSnapshot: Readonly<Record<string, unknown>>;
      loadout: Readonly<Record<string, unknown>>;
    };
    if (
      JSON.stringify(view.selfSnapshot) !== JSON.stringify(fixture.selfSnapshot) ||
      JSON.stringify(view.loadout) !== JSON.stringify(fixture.loadoutSnapshot)
    ) throw new Error("upgrade_017_existing_run_projection_changed");

    const [versions] = await sql<{ count: number }[]>`select count(*)::integer
      from game.run_self_versions where run_id = ${fixture.runId}::uuid`;
    if (versions.count !== 0) throw new Error("upgrade_017_synthesized_effective_versions");

    const resolved = await rpc(sql`
      select public.resolve_player_action_v2(
        ${fixture.actionToken}, 980000000000000017::bigint, ${fixture.playerId}::uuid,
        8017::bigint, ${fixture.actionContext}
      ) as response
    `);
    if (resolved.status !== "applied" || resolved.profileVersion !== 1) {
      throw new Error("upgrade_017_legacy_profile_action_unavailable");
    }
  });
}

async function main(): Promise<void> {
  if (await pathExists("supabase/.temp/project-ref")) {
    throw new Error("upgrade_017_remote_supabase_link_forbidden");
  }
  if (Deno.env.get("ALLOW_REMOTE_TEST_DB")?.trim()) {
    throw new Error("upgrade_017_remote_database_override_forbidden");
  }
  if (
    await sha256File("supabase/migrations/202607150016_current_card_render_cache.sql") !==
      LOCKED_016_SHA256
  ) throw new Error("upgrade_017_locked_migration_changed");

  const profile = await Deno.makeTempDir({ prefix: "tggame-upgrade-017-" });
  const environment = {
    ...Deno.env.toObject(),
    HOME: profile,
    USERPROFILE: profile,
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  const supabase = await resolveSupabaseBinary();
  let failure: unknown;
  try {
    console.log("[upgrade-017 1/5] reset through migration 016");
    await runCommand(supabase, [
      "db",
      "reset",
      "--version",
      "202607150016",
      "--local",
    ], environment);
    console.log("[upgrade-017 2/5] seed canonical fallback content");
    await runCommand(Deno.execPath(), [
      "run",
      "--allow-env",
      "--allow-net",
      "scripts/db/seed-content.ts",
    ], environment);
    console.log("[upgrade-017 3/5] seed migration-016 run and callback state");
    const fixture = await seedMigration016Fixture();
    console.log("[upgrade-017 4/5] apply migration 017 in place");
    await runCommand(supabase, ["migration", "up", "--local"], environment);
    console.log("[upgrade-017 5/5] verify preservation and adapter compatibility");
    await verifyUpgrade(fixture);
  } catch (error) {
    failure = error;
  } finally {
    console.log("[upgrade-017 cleanup] restore the full local schema");
    try {
      await runCommand(supabase, ["db", "reset", "--local"], environment);
      await runCommand(Deno.execPath(), [
        "run",
        "--allow-env",
        "--allow-net",
        "scripts/db/seed-content.ts",
      ], environment);
    } catch (error) {
      failure ??= error;
    }
    await Deno.remove(profile, { recursive: true }).catch(() => undefined);
  }
  if (failure) throw failure;
}

if (import.meta.main) await main();
