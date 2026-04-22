export const ATTRIBUTES = {
  strength:     { id: 'strength',     zh: '力量', en: 'Strength',     abbr: 'STR', category: 'physical' },
  agility:      { id: 'agility',      zh: '敏捷', en: 'Agility',      abbr: 'DEX', category: 'physical' },
  constitution: { id: 'constitution', zh: '體質', en: 'Constitution', abbr: 'CON', category: 'physical' },
  reflex:       { id: 'reflex',       zh: '反應', en: 'Reflex',       abbr: 'REF', category: 'physical' },
  intellect:    { id: 'intellect',    zh: '智力', en: 'Intellect',    abbr: 'INT', category: 'mental'   },
  willpower:    { id: 'willpower',    zh: '意志', en: 'Willpower',    abbr: 'WIL', category: 'mental'   },
  perception:   { id: 'perception',   zh: '感知', en: 'Perception',   abbr: 'PER', category: 'mental'   },
  charisma:     { id: 'charisma',     zh: '魅力', en: 'Charisma',     abbr: 'CHA', category: 'mental'   },
} as const;

export type AttributeId = keyof typeof ATTRIBUTES;
