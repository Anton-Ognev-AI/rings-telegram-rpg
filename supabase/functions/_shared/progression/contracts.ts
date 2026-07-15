import type { ResolutionV1 } from "../contracts/domain.ts";

export interface TutorialAdapterContext {
  readonly tutorialOrdinal: 1 | 2;
  readonly rescueUsed: boolean;
  readonly earlierResultCount: number;
  readonly maxHp: number;
}

export type TutorialResolutionV1 = ResolutionV1 & {
  readonly tutorial?: {
    readonly teacherRescue: true;
    readonly teacherRestore: number;
  };
};
