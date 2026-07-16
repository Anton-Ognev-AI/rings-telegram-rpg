export interface StagingCliOptions {
  readonly staging: boolean;
  readonly executeRemote: boolean;
  readonly projectRef: string;
  readonly recoveryProjectRef: string;
}

export interface StagingProjectPolicyInput extends StagingCliOptions {
  readonly confirmedProjectRef: string | undefined;
  readonly confirmedRecoveryProjectRef: string | undefined;
  readonly deniedProjectRefs: readonly string[];
  readonly linkedProjectRef: string | null;
}

export interface StagingProjectPolicyResult {
  readonly mode: "dry-run" | "remote";
  readonly linked: boolean;
}

const PROJECT_REF = /^[a-z0-9]{20}$/;
const PRODUCTION_LABEL = /(prod|production|live|main)/i;

function fail(): never {
  throw new Error("invalid_staging_arguments");
}

export function parseStagingCliArgs(args: readonly string[]): StagingCliOptions {
  let staging = false;
  let executeRemote = false;
  let projectRef: string | undefined;
  let recoveryProjectRef: string | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (seen.has(argument)) fail();
    if (argument === "--staging" || argument === "--execute-remote") {
      seen.add(argument);
      if (argument === "--staging") staging = true;
      else executeRemote = true;
      continue;
    }
    if (argument === "--project-ref" || argument === "--recovery-project-ref") {
      seen.add(argument);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail();
      index += 1;
      if (argument === "--project-ref") projectRef = value;
      else recoveryProjectRef = value;
      continue;
    }
    fail();
  }

  if (!staging || !projectRef || !recoveryProjectRef) fail();
  return { staging, executeRemote, projectRef, recoveryProjectRef };
}

function assertCanonicalRef(value: string | undefined): asserts value is string {
  if (!value || !PROJECT_REF.test(value) || PRODUCTION_LABEL.test(value)) fail();
}

export function assertStagingProjectPolicy(
  input: StagingProjectPolicyInput,
): StagingProjectPolicyResult {
  if (!input.staging) fail();
  assertCanonicalRef(input.projectRef);
  assertCanonicalRef(input.recoveryProjectRef);
  assertCanonicalRef(input.confirmedProjectRef);
  assertCanonicalRef(input.confirmedRecoveryProjectRef);
  if (
    input.projectRef === input.recoveryProjectRef ||
    input.projectRef !== input.confirmedProjectRef ||
    input.recoveryProjectRef !== input.confirmedRecoveryProjectRef
  ) fail();
  for (const denied of input.deniedProjectRefs) {
    assertCanonicalRef(denied);
    if (denied === input.projectRef || denied === input.recoveryProjectRef) fail();
  }
  const linked = input.linkedProjectRef !== null;
  if (linked) {
    assertCanonicalRef(input.linkedProjectRef ?? undefined);
    if (input.linkedProjectRef !== input.projectRef) fail();
  }
  return { mode: input.executeRemote ? "remote" : "dry-run", linked };
}
