import type { CommandResult, DatabasePort } from "./database-port.ts";

export function publishFallbackDay(database: DatabasePort, at: string): Promise<CommandResult> {
  return database.call<CommandResult>("publish_fallback_day_v1", { p_at: at });
}

export function advanceDay(database: DatabasePort, at: string): Promise<CommandResult> {
  return database.call<CommandResult>("advance_day_v1", { p_at: at });
}
