export type CardType = 'skill' | 'item' | 'spell' | 'weakness';

export interface Card {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  description: string;
}
