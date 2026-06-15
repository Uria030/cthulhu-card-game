/**
 * G-09 引擎核心 — 隱藏調查點:揭露 + 三層次調查 + 獎勵分配
 *
 * 權威依據(規則書 ch2 §13):
 * - §13.1 地點三屬性:線索數量 / 調查難度 DC / 隱藏調查點(各有感知門檻)
 * - §13.2 進地點時自動比對感知值 vs 門檻 → 達標揭露(「你注意到不對勁」)
 * - §13.3 三層次:① 一般調查成功=1 線索 ② 一般成功觸發發現隱藏點=線索+揭露
 *            ③ 直接對已揭露隱藏點調查成功=豐厚獎勵
 * - §13.4 高感知進場即發現;低感知靠一般調查成功碰運氣觸發
 *
 * 獎勵分配(Uria 2026-06-13 拍板):**每個調查員各可領一次**;
 * 限定品(限定劇情卡/獨特卡)→ 第一個啟動者拿(派旗標),後續啟動者領其他獎勵。
 *
 * 本模組為純函式,操作傳入的 HiddenPoint[](容器/bootstrap 從地點 hidden_info 載入),
 * 不耦合 ScenarioState,便於獨立測試;wiring 在 D 批次接 bootstrap/ruleEngine。
 */

export interface HiddenPoint {
  id: string;
  /** 所在地點 code */
  locationId: string;
  title: string;
  description: string;
  /** 感知門檻(§13.2:perception ≥ threshold 自動揭露) */
  threshold: number;
  /** 已對哪些調查員揭露(可見) */
  revealedTo: string[];
  /** 已領取獎勵的調查員(每人各一次) */
  claimedBy: string[];
  /** 限定品的首位領取者(劇情卡/獨特卡;null = 尚未被領) */
  limitedClaimedBy: string | null;
  /** 是否含限定品 */
  hasLimited: boolean;
  rewardType: string;
  rewardParams: Record<string, unknown>;
}

/** bootstrap 用:從地點 hidden_info row 建 HiddenPoint */
export function hiddenPointFromRow(row: Record<string, any>, locationCode: string): HiddenPoint {
  const params = (row.reward_params ?? {}) as Record<string, unknown>;
  // 限定品判定:獎勵明確標記限定/獨特,或 reward_type 為單一劇情卡/獨特卡
  const hasLimited = Boolean(
    params.is_limited || params.is_unique ||
    row.reward_type === 'story_card' || row.reward_type === 'unique_card',
  );
  return {
    id: String(row.id),
    locationId: locationCode,
    title: String(row.title_zh ?? ''),
    description: String(row.description_zh ?? ''),
    threshold: Number(row.reveal_condition_params?.threshold ?? 99),
    revealedTo: [],
    claimedBy: [],
    limitedClaimedBy: null,
    hasLimited,
    rewardType: String(row.reward_type ?? 'effect'),
    rewardParams: params,
  };
}

// ─── §13.2 進地點揭露 ───────────────────────────
export interface RevealResult {
  points: HiddenPoint[];
  /** 本次新揭露的隱藏點(供敘事) */
  newlyRevealed: HiddenPoint[];
}

/**
 * 調查員進入地點時:該地點的隱藏點,感知 ≥ 門檻者自動揭露給該調查員(§13.2)。
 */
export function revealOnEnter(
  points: HiddenPoint[],
  investigatorId: string,
  locationId: string,
  perception: number,
): RevealResult {
  const newlyRevealed: HiddenPoint[] = [];
  const next = points.map((p) => {
    if (p.locationId !== locationId) return p;
    if (p.revealedTo.includes(investigatorId)) return p;
    if (perception < p.threshold) return p;
    const updated = { ...p, revealedTo: [...p.revealedTo, investigatorId] };
    newlyRevealed.push(updated);
    return updated;
  });
  return { points: next, newlyRevealed };
}

/**
 * §13.4 低感知碰運氣:一般調查成功時,對該地點「尚未對你揭露」的第一個隱藏點揭露
 * (感知不足者透過一般調查成功觸發發現)。回傳更新後的 points + 觸發發現的點(或 null)。
 */
export function revealOnGeneralSuccess(
  points: HiddenPoint[],
  investigatorId: string,
  locationId: string,
): { points: HiddenPoint[]; discovered: HiddenPoint | null } {
  const idx = points.findIndex(
    (p) => p.locationId === locationId && !p.revealedTo.includes(investigatorId),
  );
  if (idx < 0) return { points, discovered: null };
  const updated = { ...points[idx], revealedTo: [...points[idx].revealedTo, investigatorId] };
  const next = points.map((p, i) => (i === idx ? updated : p));
  return { points: next, discovered: updated };
}

// ─── §13.3 第三層:領取已揭露隱藏點的獎勵 ──────────
export interface ClaimResult {
  points: HiddenPoint[];
  /** 是否允許領取 */
  ok: boolean;
  reason?: string;
  /** 領到的是否為限定品(首位)*/
  gotLimited: boolean;
  /** 限定品旗標(派給首位領取者;非限定品為 null) */
  limitedFlag: string | null;
  /** 領取的獎勵描述/參數(供容器結算與敘事) */
  rewardType?: string;
  rewardParams?: Record<string, unknown>;
}

/**
 * 領取隱藏點獎勵(§13.3 第三層 + Uria 分配規則):
 * - 必須已對該調查員揭露;每位各領一次(claimedBy 去重)。
 * - 含限定品:首位領取者拿限定品 + 旗標;後續領取者領其他(非限定)獎勵。
 */
export function claimHiddenReward(
  points: HiddenPoint[],
  pointId: string,
  investigatorId: string,
): ClaimResult {
  const idx = points.findIndex((p) => p.id === pointId);
  if (idx < 0) return { points, ok: false, reason: '隱藏點不存在', gotLimited: false, limitedFlag: null };
  const p = points[idx];
  if (!p.revealedTo.includes(investigatorId)) {
    return { points, ok: false, reason: '這個隱藏點還沒對你揭露', gotLimited: false, limitedFlag: null };
  }
  if (p.claimedBy.includes(investigatorId)) {
    return { points, ok: false, reason: '你已經領過這裡的獎勵了', gotLimited: false, limitedFlag: null };
  }
  // 限定品:首位領取者拿(派旗標);否則領其他獎勵
  const gotLimited = p.hasLimited && p.limitedClaimedBy === null;
  const updated: HiddenPoint = {
    ...p,
    claimedBy: [...p.claimedBy, investigatorId],
    limitedClaimedBy: gotLimited ? investigatorId : p.limitedClaimedBy,
  };
  const next = points.map((x, i) => (i === idx ? updated : x));
  const limitedFlag = gotLimited
    ? String(p.rewardParams.limited_flag ?? `hidden.${p.id}.claimed`)
    : null;
  return {
    points: next,
    ok: true,
    gotLimited,
    limitedFlag,
    rewardType: p.rewardType,
    rewardParams: p.rewardParams,
  };
}

/** 查某地點對某調查員「已揭露但未領」的隱藏點(供 UI 列「調查隱藏內容」選項) */
export function revealedUnclaimedAt(
  points: HiddenPoint[],
  locationId: string,
  investigatorId: string,
): HiddenPoint[] {
  return points.filter(
    (p) => p.locationId === locationId &&
      p.revealedTo.includes(investigatorId) &&
      !p.claimedBy.includes(investigatorId),
  );
}
