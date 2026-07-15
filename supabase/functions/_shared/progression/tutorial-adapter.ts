import type { ResolutionV1 } from "../contracts/domain.ts";
import type { TutorialAdapterContext, TutorialResolutionV1 } from "./contracts.ts";

function nextPosition(
  resolution: ResolutionV1,
): { readonly nextStage: number; readonly nextExchange: 2 | null } | null {
  if (resolution.stage < 10) {
    return { nextStage: resolution.stage + 1, nextExchange: null };
  }
  if (resolution.stage === 10 && resolution.exchange === 1) {
    return { nextStage: 10, nextExchange: 2 };
  }
  return null;
}

export function adaptTutorialResolution(
  resolution: ResolutionV1,
  context: TutorialAdapterContext | null,
): TutorialResolutionV1 {
  if (
    context === null ||
    context.tutorialOrdinal !== 1 ||
    context.rescueUsed ||
    !Number.isSafeInteger(context.earlierResultCount) ||
    context.earlierResultCount < 0 ||
    context.earlierResultCount > 1 ||
    !Number.isSafeInteger(context.maxHp) ||
    context.maxHp < 1 ||
    resolution.terminal !== "defeated" ||
    resolution.hp.after !== 0
  ) {
    return resolution;
  }

  const position = nextPosition(resolution);
  if (position === null) return resolution;
  const teacherRestore = Math.max(1, Math.ceil(context.maxHp / 2));

  return {
    ...resolution,
    hp: { ...resolution.hp, after: teacherRestore },
    terminal: null,
    ...position,
    tutorial: { teacherRescue: true, teacherRestore },
  };
}
