import type { Sql } from "npm:postgres@3.4.7";
import { sha256Hex } from "../../../supabase/functions/_shared/domain/canonical-json.ts";

export interface RpcResult {
  readonly status: string;
  readonly [key: string]: unknown;
}

export interface Fixture {
  readonly playerId: string;
  readonly cycleId: string;
  readonly runId: string;
}

export async function createFixture(
  sql: Sql,
  input: { playerId: string; cycleId: string; telegramId: bigint },
): Promise<Fixture> {
  await sql.begin(async (transaction) => {
    await transaction`insert into game.players(id, personal_label)
      values (${input.playerId}, 'Synthetic Integration Student')`;
    await transaction`insert into game.identity_links(player_id, platform, external_id)
      values (${input.playerId}, 'telegram', ${input.telegramId.toString()}::bigint)`;
    await transaction`insert into game.player_stats(
      player_id, physical, magical, agility, vitality, defense, max_hp
    ) values (${input.playerId}, 5, 5, 5, 5, 5, 40)`;
    await transaction`insert into game.xp_accounts(player_id) values (${input.playerId})`;
    await transaction`insert into game.dungeon_days(
      cycle_id, content_version_id, opens_at, closes_at, grace_ends_at, status
    ) values (
      ${input.cycleId}::date,
      '20000000-0000-4000-8000-000000000001',
      ((${input.cycleId}::date + time '09:00') at time zone 'Europe/Kyiv'),
      ((((${input.cycleId}::date + 1) + time '09:00')) at time zone 'Europe/Kyiv'),
      ((((${input.cycleId}::date + 1) + time '09:00')) at time zone 'Europe/Kyiv')
        + interval '2 hours',
      'fallback_ready'
    )`;
  });

  const [started] = await sql<{ response: RpcResult }[]>`select public.start_run_v1(
    ${input.playerId}::uuid,
    ${input.cycleId}::date,
    ${
    sql.json({
      maxHp: 40,
      physical: 5,
      magical: 5,
      agility: 5,
      vitality: 5,
      defense: 5,
      vampRateBps: 0,
      postHeal: 0,
    })
  }::jsonb,
    ${"a".repeat(64)},
    ${sql.json({ items: [], rings: [] })}::jsonb,
    ${"b".repeat(64)}
  ) as response`;
  if (started.response.status !== "applied") {
    throw new Error(`fixture start: ${started.response.status}`);
  }
  const projection = started.response.projection as { run: { id: string } };
  return { ...input, runId: projection.run.id };
}

export function resolution(
  choiceId: string,
  outcome: "success" | "neutral" | "failure" = "neutral",
): Readonly<Record<string, unknown>> {
  const damage = outcome === "failure" ? 5 : outcome === "neutral" ? 2 : 0;
  const xp = outcome === "failure" ? 0 : outcome === "neutral" ? 2 : 10;
  return {
    resolverVersion: "v1",
    stage: 1,
    exchange: null,
    choiceId,
    outcome,
    hp: { before: 40, damage, vampHeal: 0, postHeal: 0, after: 40 - damage },
    bossHp: null,
    xp: { before: 0, delta: xp, after: xp },
    terminal: null,
    nextStage: 2,
    nextExchange: null,
  };
}

export async function prepare(
  sql: Sql,
  fixture: Fixture,
  seed: string,
  choiceId = "s1-neutral",
  outcome: "success" | "neutral" | "failure" = "neutral",
): Promise<{ token: string; context: string; response: RpcResult }> {
  const token = await sha256Hex(`token:${seed}`);
  const context = await sha256Hex(`context:${fixture.runId}:0`);
  const preparedResolution = resolution(choiceId, outcome);
  const resolutionHash = await sha256Hex(JSON.stringify(preparedResolution));
  const [row] = await sql<{ response: RpcResult }[]>`select public.prepare_action_v1(
    ${fixture.playerId}::uuid,
    ${fixture.runId}::uuid,
    ${token},
    0::bigint,
    1::smallint,
    0::smallint,
    ${choiceId},
    ${context},
    ${sql.json(JSON.parse(JSON.stringify(preparedResolution)))}::jsonb,
    ${resolutionHash},
    clock_timestamp() + interval '1 hour'
  ) as response`;
  return { token, context, response: row.response };
}

export async function resolve(
  sql: Sql,
  input: { token: string; updateId: bigint; playerId: string; context: string },
): Promise<RpcResult> {
  const [row] = await sql<{ response: RpcResult }[]>`select public.resolve_choice_v1(
    ${input.token}, ${input.updateId.toString()}::bigint, ${input.playerId}::uuid, ${input.context}
  ) as response`;
  return row.response;
}

export async function effectCounts(sql: Sql, runId: string): Promise<{
  stateVersion: number;
  stageResults: number;
  ledger: number;
  outbox: number;
  processed: number;
}> {
  const [row] = await sql<{
    state_version: number;
    stage_results: number;
    ledger: number;
    outbox: number;
    processed: number;
  }[]>`select
    r.state_version::integer,
    (select count(*)::integer from game.run_stage_results where run_id = r.id) as stage_results,
    (select count(*)::integer from game.xp_ledger where source_id = r.id) as ledger,
    (select count(*)::integer from game.outbox_messages
      where logical_key like ('run:' || r.id || ':%')) as outbox,
    (select count(*)::integer from game.processed_actions pa join game.action_tokens at
      on at.token_sha256 = pa.token_sha256 where at.run_id = r.id) as processed
  from game.runs r where r.id = ${runId}::uuid`;
  return {
    stateVersion: row.state_version,
    stageResults: row.stage_results,
    ledger: row.ledger,
    outbox: row.outbox,
    processed: row.processed,
  };
}
