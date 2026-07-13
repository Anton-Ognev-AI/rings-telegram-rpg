export interface MigrationChecksum {
  readonly file: string;
  readonly sha256: string;
}

export function formatChecksumManifest(entries: readonly MigrationChecksum[]): string {
  return [...entries]
    .sort((left, right) => left.file.localeCompare(right.file))
    .map(({ file, sha256 }) => `${sha256}  ${file}\n`)
    .join("");
}

export function verifyChecksumManifest(expected: string, actual: string): void {
  if (actual !== expected) throw new Error("migration checksum drift detected");
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function collectMigrationChecksums(directory: string): Promise<MigrationChecksum[]> {
  const entries: MigrationChecksum[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !/^\d{12}_.+\.sql$/.test(entry.name)) continue;
    const bytes = await Deno.readFile(`${directory}/${entry.name}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    entries.push({ file: entry.name, sha256: toHex(digest) });
  }
  return entries;
}

async function main(): Promise<void> {
  const directory = "supabase/migrations";
  const manifestPath = `${directory}/SHA256SUMS`;
  const actual = formatChecksumManifest(await collectMigrationChecksums(directory));
  const mode = Deno.args[0] ?? "--print";

  if (mode === "--write") {
    await Deno.writeTextFile(manifestPath, actual);
    return;
  }
  if (mode === "--verify") {
    const expected = await Deno.readTextFile(manifestPath);
    verifyChecksumManifest(expected, actual);
    return;
  }
  if (mode !== "--print") throw new Error(`unknown mode: ${mode}`);
  await Deno.stdout.write(new TextEncoder().encode(actual));
}

if (import.meta.main) await main();
