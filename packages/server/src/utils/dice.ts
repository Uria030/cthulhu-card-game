/** 伺服器端 d20 擲骰 — 所有骰子結果必須由伺服器產生（反作弊） */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function skillCheck(
  roll: number,
  modifier: number,
  dc: number
): { success: boolean; total: number; margin: number } {
  const total = roll + modifier;
  return {
    success: total >= dc,
    total,
    margin: total - dc,
  };
}
