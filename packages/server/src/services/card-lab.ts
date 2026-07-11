export const CARD_LAB_USERNAMES = ['creator01', 'creator02'] as const;

const CARD_LAB_USERNAME_SET = new Set<string>(CARD_LAB_USERNAMES);

export function isCardLabCreator(username: unknown): boolean {
  return CARD_LAB_USERNAME_SET.has(String(username ?? '').trim().toLowerCase());
}

export const CARD_LAB_MANIFEST = {
  id: 'card-lab',
  version: 1,
  title: '卡片效果實驗場',
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

