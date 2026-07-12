function encodeCanonical(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Unsupported canonical value at ${path}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new Error(`Unsupported canonical value at ${path}[${index}]`);
      items.push(encodeCanonical(value[index], `${path}[${index}]`));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Unsupported canonical value at ${path}`);
    }
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${encodeCanonical(record[key], `${path}.${key}`)}`
      ).join(",")
    }}`;
  }
  throw new Error(`Unsupported canonical value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, "$");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
