import type { ResolutionV1 } from "../contracts/domain.ts";
import { canonicalJson, sha256Hex } from "./canonical-json.ts";
import { resolveChoiceV1, type ResolveChoiceV1Input } from "./resolvers/v1/resolver.ts";

export interface Resolver {
  readonly resolveChoice: (input: ResolveChoiceV1Input) => ResolutionV1;
}

const resolvers: Readonly<Record<string, Resolver>> = Object.freeze({
  v1: { resolveChoice: resolveChoiceV1 },
});

export function getResolver(version: string): Resolver {
  const resolver = resolvers[version];
  if (!resolver) throw new Error(`Unsupported resolver version: ${version}`);
  return resolver;
}

export async function resolveAndHash(input: ResolveChoiceV1Input): Promise<{
  readonly resolution: ResolutionV1;
  readonly canonical: string;
  readonly hash: string;
}> {
  if (input.content.resolverVersion !== input.command.resolverVersion) {
    throw new Error("Content and command resolver versions differ");
  }
  const resolution = getResolver(input.command.resolverVersion).resolveChoice(input);
  const canonical = canonicalJson(resolution);
  return { resolution, canonical, hash: await sha256Hex(canonical) };
}
