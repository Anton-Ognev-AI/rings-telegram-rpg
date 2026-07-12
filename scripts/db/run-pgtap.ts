import { withDatabase } from "./local-database.ts";

function collectStrings(value: unknown, target: string[]): void {
  if (typeof value === "string") {
    target.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, target);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, target);
  }
}

export function assertPgTapResults(results: unknown): number {
  const lines: string[] = [];
  collectStrings(results, lines);
  const planLine = lines.find((line) => /^1\.\.\d+$/.test(line));
  if (!planLine) throw new Error("pgTAP output has no plan");
  const planned = Number(planLine.slice(3));
  const assertions = lines.filter((line) => /^(?:not )?ok\s+\d+\b/.test(line));
  const failure = assertions.find((line) => line.startsWith("not ok "));
  if (failure) throw new Error(`pgTAP assertion failed: ${failure}`);
  if (assertions.length !== planned) {
    throw new Error(`pgTAP expected ${planned} assertions but received ${assertions.length}`);
  }
  return planned;
}

async function testFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith(".test.sql")) files.push(entry.name);
  }
  return files.sort();
}

async function main(): Promise<void> {
  const directory = "supabase/tests";
  const files = await testFiles(directory);
  if (files.length === 0) throw new Error("no pgTAP test files found");

  await withDatabase(async (sql) => {
    const [{ installed }] = await sql<{ installed: boolean }[]>`
      select exists(select 1 from pg_catalog.pg_extension where extname = 'pgtap') as installed
    `;
    if (!installed) await sql.unsafe("create extension pgtap with schema extensions");
    const connection = await sql.reserve();
    try {
      for (const file of files) {
        const testSql = await Deno.readTextFile(`${directory}/${file}`);
        const result = await connection.unsafe(
          `set search_path = public, extensions, pg_catalog;\n${testSql}`,
        );
        const count = assertPgTapResults(result);
        console.log(`${file}: ${count} passed`);
      }
    } finally {
      connection.release();
    }
  });
}

if (import.meta.main) await main();
