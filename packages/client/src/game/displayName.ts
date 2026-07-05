export interface DisplayNameSource {
  name_zh?: string | null;
  title_zh?: string | null;
  mbti_code?: string | null;
  code?: string | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function displayNameFor(
  inv: DisplayNameSource | null | undefined,
  fallback = '未選擇',
): string {
  if (!inv) return fallback;
  return clean(inv.name_zh) || clean(inv.title_zh) || clean(inv.mbti_code) || clean(inv.code) || fallback;
}
