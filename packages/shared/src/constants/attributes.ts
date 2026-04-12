export const ATTRIBUTES = {
  strength:     { id: 'strength',     zh: '力量', en: 'Strength',     abbr: 'STR' },
  agility:      { id: 'agility',      zh: '敏捷', en: 'Agility',      abbr: 'DEX' },
  constitution: { id: 'constitution', zh: '體質', en: 'Constitution', abbr: 'CON' },
  intellect:    { id: 'intellect',    zh: '智力', en: 'Intellect',    abbr: 'INT' },
  willpower:    { id: 'willpower',    zh: '意志', en: 'Willpower',    abbr: 'WIL' },
  perception:   { id: 'perception',   zh: '感知', en: 'Perception',   abbr: 'PER' },
  charisma:     { id: 'charisma',     zh: '魅力', en: 'Charisma',     abbr: 'CHA' },
} as const;

export type AttributeId = keyof typeof ATTRIBUTES;
