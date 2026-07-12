import type { Sql } from "npm:postgres@3.4.7";
import { withDatabase } from "./local-database.ts";

export interface ReconciliationResult {
  readonly accountMismatches: number;
  readonly cycleMismatches: number;
  readonly actionMismatches: number;
}

export async function reconcileDatabase(sql: Sql): Promise<ReconciliationResult> {
  const [accounts] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from game.xp_accounts account
    where account.balance <> coalesce((
      select sum(ledger.applied_delta) from game.xp_ledger ledger
      where ledger.player_id = account.player_id
    ), 0)
  `;
  const [cycles] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from game.player_cycle_xp_earnings cycle
    where cycle.earned <> coalesce((
      select sum(ledger.applied_delta) from game.xp_ledger ledger
      where ledger.player_id = cycle.player_id
        and ledger.cycle_id = cycle.cycle_id
        and ledger.cap_subject
    ), 0)
  `;
  const [actions] = await sql<{ count: number }[]>`
    select count(*)::integer as count
    from game.processed_actions processed
    join game.action_tokens token on token.token_sha256 = processed.token_sha256
    where processed.status = 'applied' and (
      not exists(
        select 1 from game.run_stage_results result
        where result.run_id = token.run_id
          and result.stage = token.stage
          and result.exchange = token.exchange
      )
      or not exists(
        select 1 from game.outbox_messages outbox
        where outbox.logical_key = format(
          'run:%s:state:%s', token.run_id, token.expected_state_version + 1
        )
      )
    )
  `;
  return {
    accountMismatches: accounts.count,
    cycleMismatches: cycles.count,
    actionMismatches: actions.count,
  };
}

async function main(): Promise<void> {
  await withDatabase(async (sql) => {
    const result = await reconcileDatabase(sql);
    console.log(JSON.stringify(result));
    if (Object.values(result).some((count) => count !== 0)) {
      throw new Error("database reconciliation mismatch");
    }
  });
}

if (import.meta.main) await main();
