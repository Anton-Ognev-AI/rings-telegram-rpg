import { withDatabase } from "./local-database.ts";

const npm = Deno.build.os === "windows" ? "npm.cmd" : "npm";
const LEGACY_PLAYER_ID = "94000000-0000-4000-8000-000000000099";
const LEGACY_EXTERNAL_ID = 940000000000000099n;

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
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
  if (!status.success) throw new Error(`upgrade_013_command_failed:${args.join(":")}`);
}

async function seedLegacyFixture(): Promise<void> {
  await withDatabase(async (sql) => {
    await sql.begin(async (transaction) => {
      await transaction`insert into game.config_versions(
        id, version, resolver_version, payload, payload_sha256, daily_xp_cap, status
      ) values (
        '00000000-0000-4000-8000-000000000001', 'config-v1', 'v1', '{}'::jsonb,
        ${"1".repeat(64)}, 150, 'active'
      )`;
      await transaction`insert into game.players(id, personal_label)
        values (${LEGACY_PLAYER_ID}::uuid, 'Legacy Student 013')`;
      await transaction`insert into game.identity_links(player_id, platform, external_id)
        values (${LEGACY_PLAYER_ID}::uuid, 'telegram', ${LEGACY_EXTERNAL_ID.toString()}::bigint)`;
      await transaction`insert into game.player_stats(
        player_id, physical, magical, agility, vitality, defense, max_hp
      ) values (${LEGACY_PLAYER_ID}::uuid, 8, 7, 6, 5, 4, 44)`;
      await transaction`insert into game.xp_accounts(player_id, balance, lifetime_earned)
        values (${LEGACY_PLAYER_ID}::uuid, 17, 17)`;
    });
  });
}

async function verifyUpgradedFixture(): Promise<void> {
  await withDatabase(async (sql) => {
    const [legacy] = await sql<{
      personal_label: string;
      external_id: string;
      physical: number;
      magical: number;
      agility: number;
      vitality: number;
      defense: number;
      max_hp: number;
      balance: number;
    }[]>`select p.personal_label, i.external_id::text, s.physical, s.magical, s.agility,
      s.vitality, s.defense, s.max_hp, x.balance::integer
      from game.players p
      join game.identity_links i on i.player_id = p.id
      join game.player_stats s on s.player_id = p.id
      join game.xp_accounts x on x.player_id = p.id
      where p.id = ${LEGACY_PLAYER_ID}::uuid`;
    const expected = {
      personal_label: "Legacy Student 013",
      external_id: LEGACY_EXTERNAL_ID.toString(),
      physical: 8,
      magical: 7,
      agility: 6,
      vitality: 5,
      defense: 4,
      max_hp: 44,
      balance: 17,
    };
    if (JSON.stringify(legacy) !== JSON.stringify(expected)) {
      throw new Error("upgrade_013_legacy_state_changed");
    }

    const [identity] = await sql<{ response: Record<string, unknown> }[]>`
      select public.telegram_identity_v2(
        ${LEGACY_EXTERNAL_ID.toString()}::bigint, false
      ) as response`;
    if (
      identity.response.status !== "ok" ||
      identity.response.playerId !== LEGACY_PLAYER_ID ||
      identity.response.tutorialCompleted !== 0 ||
      identity.response.profileVersion !== 0
    ) throw new Error("upgrade_013_lazy_initialization_failed");

    const [phase4] = await sql<{
      onboarding: number;
      progression: number;
      tutorial_flag_enabled: boolean;
    }[]>`select
      (select count(*)::integer from game.player_onboarding
        where player_id = ${LEGACY_PLAYER_ID}::uuid) as onboarding,
      (select count(*)::integer from game.player_stat_progression
        where player_id = ${LEGACY_PLAYER_ID}::uuid) as progression,
      (select enabled from game.feature_flags where key = 'tutorial_starter_enabled')
        as tutorial_flag_enabled`;
    if (
      phase4.onboarding !== 1 || phase4.progression !== 1 || phase4.tutorial_flag_enabled
    ) throw new Error("upgrade_013_phase4_state_invalid");
  });
}

async function main(): Promise<void> {
  if (await pathExists("supabase/.temp/project-ref")) {
    throw new Error("upgrade_013_remote_supabase_link_forbidden");
  }
  if (Deno.env.get("ALLOW_REMOTE_TEST_DB")?.trim()) {
    throw new Error("upgrade_013_remote_database_override_forbidden");
  }
  const profile = await Deno.makeTempDir({ prefix: "tggame-upgrade-013-" });
  const environment = {
    ...Deno.env.toObject(),
    HOME: profile,
    USERPROFILE: profile,
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  let failure: unknown;
  try {
    console.log("[upgrade-013 1/4] reset through migration 013");
    await runNpm([
      "run",
      "supabase",
      "--",
      "db",
      "reset",
      "--version",
      "202607130013",
      "--no-seed",
      "--local",
    ], environment);
    console.log("[upgrade-013 2/4] seed legacy player state");
    await seedLegacyFixture();
    console.log("[upgrade-013 3/4] apply migration 014 in place");
    await runNpm([
      "run",
      "supabase",
      "--",
      "migration",
      "up",
      "--local",
    ], environment);
    console.log("[upgrade-013 4/4] verify preservation and lazy initialization");
    await verifyUpgradedFixture();
  } catch (error) {
    failure = error;
  } finally {
    console.log("[upgrade-013 cleanup] restore the full local schema");
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
