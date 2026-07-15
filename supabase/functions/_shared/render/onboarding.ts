import { renderTutorialCard } from "./tutorial.ts";
import type { RenderedCard } from "./types.ts";

export function renderOnboardingCard(): RenderedCard {
  return renderTutorialCard({
    completed: 0,
    hasActiveRun: false,
    initialTrainingResolved: false,
  });
}
