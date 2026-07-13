import type { DatabasePort } from "../application/database-port.ts";

export type FetchPort = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class SupabaseRpcDatabase implements DatabasePort {
  readonly #baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly serviceRoleKey: string,
    private readonly fetcher: FetchPort = fetch,
  ) {
    const parsed = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) || parsed.username !== "" ||
      parsed.password !== "" || serviceRoleKey.length === 0
    ) throw new Error("invalid_supabase_rpc_configuration");
    this.#baseUrl = parsed.toString().replace(/\/$/u, "");
  }

  async call<T>(rpc: string, args: Readonly<Record<string, unknown>>): Promise<T> {
    if (!/^[a-z][a-z0-9_]{0,127}$/u.test(rpc)) throw new Error("invalid_supabase_rpc_name");
    let response: Response;
    try {
      response = await this.fetcher(`${this.#baseUrl}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: {
          apikey: this.serviceRoleKey,
          Authorization: `Bearer ${this.serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
    } catch {
      throw new Error("supabase_rpc_unreachable");
    }
    if (!response.ok) throw new Error(`supabase_rpc_${response.status}`);
    try {
      return await response.json() as T;
    } catch {
      throw new Error("supabase_rpc_invalid_response");
    }
  }
}
