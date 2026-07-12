export const CARD_LAB_USERNAMES = ['creator01', 'creator02'] as const;

const CARD_LAB_USERNAME_SET = new Set<string>(CARD_LAB_USERNAMES);

export function isCardLabCreator(username: unknown): boolean {
  return CARD_LAB_USERNAME_SET.has(String(username ?? '').trim().toLowerCase());
}

export const CARD_LAB_REVIEW_STATUSES = ['pass', 'warn', 'block'] as const;
export type CardLabReviewStatus = typeof CARD_LAB_REVIEW_STATUSES[number];

export function parseCardLabReview(input: unknown):
  | { ok: true; status: CardLabReviewStatus; notes: string }
  | { ok: false; error: string } {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const status = String(body.status ?? '').trim().toLowerCase();
  const notes = String(body.notes ?? '').trim();
  if (!CARD_LAB_REVIEW_STATUSES.includes(status as CardLabReviewStatus)) {
    return { ok: false, error: '評價必須是 PASS、WARN 或 BLOCK' };
  }
  if (notes.length > 5000) return { ok: false, error: '評價紀錄不可超過 5000 字' };
  if ((status === 'warn' || status === 'block') && notes.length === 0) {
    return { ok: false, error: 'WARN 與 BLOCK 必須填寫紀錄' };
  }
  return { ok: true, status: status as CardLabReviewStatus, notes };
}

export const CARD_LAB_MANIFEST = {
  id: 'card-lab',
  version: 2,
  title: '卡片良率檢驗所',
  locations: [
    {
      code: 'card_lab_entrance',
      name_zh: '實驗場入口',
      description_zh: '厚重的黃銅門隔開雨夜與測試區。所有紀錄從這裡開始。',
      shroud: 0,
    },
    {
      code: 'card_lab_workbench',
      name_zh: '卡片實驗室',
      description_zh: '量測儀器、測試紙條與一具木製標靶等待每一張卡片接受驗證。',
      shroud: 0,
    },
  ],
  enemy: {
    code: 'card_lab_training_dummy',
    name_zh: '訓練木人',
    hp: 999,
    dc: 10,
    damage_physical: 0,
    damage_horror: 0,
    fear_value: 0,
    movement_speed: 0,
  },
} as const;
