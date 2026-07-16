import { assertEquals } from "jsr:@std/assert@1.0.19";
import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "../../scripts/db/local-database.ts";
import {
  advanceDay,
  publishFallbackDay,
} from "../../supabase/functions/_shared/application/day-cycle.ts";
import { PostgresRpcDatabase } from "./helpers/postgres-rpc.ts";

const at = "2026-10-10T07:00:00.000Z";
const afterGrace = "2026-10-11T09:00:00.000Z";

interface TutorialFixture {
  readonly playerId: string;
  readonly runId: string;
}

async function startTutorial(
  database: PostgresRpcDatabase,
  externalId: bigint,
): Promise<TutorialFixture> {
  const identity = await database.call<{ status: string; playerId: string }>(
    "telegram_identity_v2",
    { p_external_id: externalId.toString(), p_create_if_missing: true },
  );
  assertEquals(identity.status, "ok");
  const started = await database.call<{
    status: string;
    projection: { run: { id: string } };
  }>("start_run_v3", { p_player_id: identity.playerId, p_at: at });
  assertEquals(started.status, "applied");
  return { playerId: identity.playerId, runId: started.projection.run.id };
}

async function seedNeutralResults(
  sql: Sql,
  fixture: TutorialFixture,
  count: number,
): Promise<void> {
  for (let stage = 1; stage <= count; stage += 1) {
    const resolution = {
      resolverVersion: "v1",
      stage,
      exchange: null,
      choiceId: `terminal-path-${stage}`,
      outcome: "neutral",
      hp: { before: 45, damage: 0, vampHeal: 0, postHeal: 0, after: 45 },
      bossHp: null,
      xp: { before: 0, delta: 0, after: 0 },
      terminal: null,
      nextStage: stage + 1,
      nextExchange: null,
    };
    await sql`insert into game.run_stage_results(
        run_id, stage, exchange, choice_id, resolution, resolution_sha256
      ) values (
        ${fixture.runId}::uuid, ${stage}::smallint, 0,
        ${`terminal-path-${stage}`}, ${sql.json(resolution)}::jsonb, ${"a".repeat(64)}
      )`;
  }
  await sql`update game.runs set stage = ${count + 1}, state_version = ${count}
    where id = ${fixture.runId}::uuid`;
}

Deno.test("tutorial expiry credits three results but not start-only, short, or abandoned attempts", async () => {
  await withDatabase(async (sql) => {
    const database = new PostgresRpcDatabase(sql);
    assertEquals((await publishFallbackDay(database, at)).status, "applied");
    assertEquals((await advanceDay(database, at)).status, "ok");

    const startOnly = await startTutorial(database, 920000501n);
    const tooShort = await startTutorial(database, 920000502n);
    const eligible = await startTutorial(database, 920000503n);
    const abandoned = await startTutorial(database, 920000504n);
    const naturalTerminal = await startTutorial(database, 920000505n);
    await seedNeutralResults(sql, tooShort, 2);
    await seedNeutralResults(sql, eligible, 3);
    await seedNeutralResults(sql, naturalTerminal, 3);
    await sql`update game.runs set status = 'finished_victory', hp = 10,
        finished_at = ${at}::timestamptz
      where id = ${naturalTerminal.runId}::uuid`;
    const [naturalCredit] = await sql<{ result: Record<string, unknown> }[]>`select
      game.credit_tutorial_run_v1(
        ${naturalTerminal.runId}::uuid,
        ${at}::timestamptz
      ) as result`;
    assertEquals(naturalCredit.result.status, "applied");
    assertEquals(naturalCredit.result.reason, "natural_terminal");
    assertEquals(
      await database.call("abandon_run_v1", {
        p_player_id: abandoned.playerId,
        p_run_id: abandoned.runId,
      }),
      { status: "applied", runId: abandoned.runId },
    );

    const advanced = await database.call<{
      status: string;
      tutorialCredits: number;
    }>("advance_day_v2", { p_at: afterGrace });
    assertEquals(advanced.status, "ok");
    assertEquals(advanced.tutorialCredits, 1);

    const states = await sql<{
      player_id: string;
      run_status: string;
      completed: number;
      credits: number;
      grants: number;
      results: number;
      credit_reason: string | null;
    }[]>`select
        o.player_id,
        r.status::text as run_status,
        o.tutorial_completed::integer as completed,
        case when a.credited_at is not null then 1 else 0 end as credits,
        a.credit_reason,
        (select count(*)::integer from game.xp_ledger x
          where x.player_id = o.player_id and x.source_type = 'tutorial_completion') as grants,
        (select count(*)::integer from game.run_stage_results s
          where s.run_id = r.id) as results
      from game.player_onboarding o
      join game.tutorial_run_assignments a on a.player_id = o.player_id
      join game.runs r on r.id = a.run_id
      where o.player_id in (
        ${startOnly.playerId}::uuid, ${tooShort.playerId}::uuid,
        ${eligible.playerId}::uuid, ${abandoned.playerId}::uuid,
        ${naturalTerminal.playerId}::uuid
      )`;
    const byPlayer = new Map(states.map((state) => [state.player_id, state]));
    assertEquals(byPlayer.get(startOnly.playerId), {
      player_id: startOnly.playerId,
      run_status: "expired",
      completed: 0,
      credits: 0,
      grants: 0,
      results: 0,
      credit_reason: null,
    });
    assertEquals(byPlayer.get(tooShort.playerId), {
      player_id: tooShort.playerId,
      run_status: "expired",
      completed: 0,
      credits: 0,
      grants: 0,
      results: 2,
      credit_reason: null,
    });
    assertEquals(byPlayer.get(eligible.playerId), {
      player_id: eligible.playerId,
      run_status: "expired",
      completed: 1,
      credits: 1,
      grants: 1,
      results: 3,
      credit_reason: "eligible_expiry",
    });
    assertEquals(byPlayer.get(abandoned.playerId), {
      player_id: abandoned.playerId,
      run_status: "abandoned",
      completed: 0,
      credits: 0,
      grants: 0,
      results: 0,
      credit_reason: null,
    });
    assertEquals(byPlayer.get(naturalTerminal.playerId), {
      player_id: naturalTerminal.playerId,
      run_status: "finished_victory",
      completed: 1,
      credits: 1,
      grants: 1,
      results: 3,
      credit_reason: "natural_terminal",
    });
  });
});
