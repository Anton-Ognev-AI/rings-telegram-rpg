export interface Clock {
  now(): Date;
}

export class FixedClock implements Clock {
  readonly #instantMs: number;

  constructor(instant: string | Date) {
    this.#instantMs = new Date(instant).getTime();
  }

  now(): Date {
    return new Date(this.#instantMs);
  }
}
