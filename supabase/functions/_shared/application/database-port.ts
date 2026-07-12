export interface DatabasePort {
  call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T>;
}

export interface CommandResult {
  readonly status: "applied" | "cached" | "stale" | "rejected" | "ok" | "none";
  readonly [key: string]: unknown;
}
