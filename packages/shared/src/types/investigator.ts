import type { AttributeId } from '../constants/attributes';

export interface Investigator {
  id: string;
  name: string;
  attributes: Record<AttributeId, number>;
  hp: number;
  maxHp: number;
  san: number;
  maxSan: number;
}
