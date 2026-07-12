export interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface CycleWindow {
  readonly cycleId: string;
  readonly opensAt: Date;
  readonly closesAt: Date;
  readonly graceEndsAt: Date;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(instant: Date, timeZone: string): LocalDateTimeParts {
  const values = new Map(
    formatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function partsAsUtc(parts: LocalDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

export function zonedLocalToUtc(
  local: LocalDateTimeParts,
  timeZone: string,
): Date {
  let candidateMs = partsAsUtc(local);
  for (let attempt = 0; attempt < 3; attempt++) {
    const observed = partsAt(new Date(candidateMs), timeZone);
    if (sameParts(observed, local)) return new Date(candidateMs);
    candidateMs += partsAsUtc(local) - partsAsUtc(observed);
  }
  const candidate = new Date(candidateMs);
  if (!sameParts(partsAt(candidate, timeZone), local)) {
    throw new Error(`Local time does not resolve in ${timeZone}`);
  }
  return candidate;
}

function addCalendarDays(
  date: Pick<LocalDateTimeParts, "year" | "month" | "day">,
  days: number,
): Pick<LocalDateTimeParts, "year" | "month" | "day"> {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function cycleId(date: Pick<LocalDateTimeParts, "year" | "month" | "day">): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function getCycleWindow(now: Date): CycleWindow {
  if (!Number.isFinite(now.getTime())) throw new Error("Cycle instant must be a valid Date");
  const timeZone = "Europe/Kyiv";
  const localNow = partsAt(now, timeZone);
  const localDate = { year: localNow.year, month: localNow.month, day: localNow.day };
  const openDate = localNow.hour < 9 ? addCalendarDays(localDate, -1) : localDate;
  const closeDate = addCalendarDays(openDate, 1);
  const atNine = (date: Pick<LocalDateTimeParts, "year" | "month" | "day">) =>
    zonedLocalToUtc({ ...date, hour: 9, minute: 0, second: 0 }, timeZone);
  const opensAt = atNine(openDate);
  const closesAt = atNine(closeDate);
  return {
    cycleId: cycleId(openDate),
    opensAt,
    closesAt,
    graceEndsAt: new Date(closesAt.getTime() + 2 * 60 * 60 * 1000),
  };
}
