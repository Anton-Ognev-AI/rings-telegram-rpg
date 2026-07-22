import { assertEquals } from "jsr:@std/assert@1.0.19";

Deno.test("upgrade-017 verifier accepts the packaged Windows supabase-go binary", async () => {
  const module = await import("../../scripts/db/verify-upgrade-017.ts");
  const candidateFactory = (module as Readonly<Record<string, unknown>>)
    .supabaseBinaryCandidates;

  assertEquals(typeof candidateFactory, "function");
  if (typeof candidateFactory !== "function") return;

  assertEquals(
    (candidateFactory as (os: string, arch: string) => readonly string[])(
      "windows",
      "x86_64",
    ),
    [
      "node_modules/@supabase/cli-windows-x64/bin/supabase.exe",
      "node_modules/@supabase/cli-windows-x64/bin/supabase-go.exe",
      "../../node_modules/@supabase/cli-windows-x64/bin/supabase.exe",
      "../../node_modules/@supabase/cli-windows-x64/bin/supabase-go.exe",
    ],
  );
});
