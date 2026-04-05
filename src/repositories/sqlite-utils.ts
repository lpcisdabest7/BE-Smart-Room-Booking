export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function parseJsonObject<T extends Record<string, unknown>>(value: string | null | undefined): T {
  if (!value) {
    return {} as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isTruthyFlag(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}
