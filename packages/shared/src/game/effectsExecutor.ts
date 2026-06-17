/**
 * G-02 引擎核心 — 卡片效果執行器(首批)
 *
 * 範圍:裂嘴女關卡 ISTP 牌組實際用到的 effect_code(資料盤點 2026-06-11):
 *   draw_card / gain_resource / deal_damage / discover_clue /
 *   add_status(對敵)/ search_deck(簡化)
 * 其餘 effect_code 回報 unsupported(不結算、不擋牌),後續批次擴充。
 *
 * 設計:純函式,吃狀態回新狀態 + ResultEffect[];不碰訊息匯流排。
 * - modify_test(passive)不在這裡執行 — 檢定時由 passiveTestModifier 聚合
 * - on_commit modify_test 不執行(與 commit_icons 同值重複,以圖示為準)
 * - attack(武器行動)不在這裡 — 走 ruleEngine 武器攻擊路徑(§8 風格卡抽取)
 */
import type { ResultEffect } from './messages';
import type { InvestigatorState, ScenarioState } from './state';
import type { CardDataLookup } from './ruleEngine';
import { addStatus, removeStatus, NEGATIVE_STATUSES, elementalDamageBonus } from './statusEffects';

export interface CardEffectRow {
  trigger_type: string;
  effect_code: string;
  effect_params: Record<string, unknown> | null;
  duration?: string | null;
  description_zh?: string | null;
}

export interface ExecuteResult {
  investigator: InvestigatorState;
  scenario: ScenarioState;
  effects: ResultEffect[];
  /** 引擎不支援的 code(回報給 log,不視為錯誤) */
  unsupported: string[];
}

export function executeCardEffects(
  cardEffects: CardEffectRow[],
  investigator: InvestigatorState,
  scenario: ScenarioState,
  cardLookup: CardDataLookup,
  rng: () => number = Math.random,
): ExecuteResult {
  let inv = investigator;
  let sc = scenario;
  const out: ResultEffect[] = [];
  const unsupported: string[] = [];

  for (const fx of cardEffects) {
    const p = (fx.effect_params ?? {}) as Record<string, any>;
    // 防禦性正規化:剝除效果碼尾端括號修飾(髒值 deal_damage(single-target) → deal_damage)
    // 同步把括號內提示併入 params(single-target → 非 area)
    const rawCode = String(fx.effect_code ?? '');
    const paren = rawCode.match(/^([a-z_]+)\((.+)\)$/);
    const code = paren ? paren[1] : rawCode;
    if (paren && /area/.test(paren[2])) p.area = true;
    // 軸向連動條件(s08–s10 軸向 combo):此效果帶 condition 且不滿足 → 不結算(combo 未成形;
    // 基礎效果放在別的「無條件」effect entry,照常結算)。
    if (p.condition && !axisConditionMet(p.condition as Record<string, unknown>, inv, cardLookup)) {
      out.push({ type: 'combo_inactive', params: { axis: String((p.condition as Record<string, unknown>).axis_value ?? ''), narrative: '軸向連動尚未成形 —— 只發揮了基礎效果。' } });
      continue;
    }
    switch (code) {
      case 'draw_card': {
        const amount = Number(p.amount ?? 1);
        for (let i = 0; i < amount; i += 1) {
          if (inv.deck.length === 0) {
            // §3.3 牌庫空:抽牌改受 1 恐懼
            inv = { ...inv, san: Math.max(0, inv.san - 1) };
            out.push({ type: 'deck_empty_horror', params: { amount: 1 } });
            continue;
          }
          const drawn = inv.deck[0];
          inv = { ...inv, deck: inv.deck.slice(1), hand: [...inv.hand, drawn] };
          out.push({ type: 'draw_card', params: { cardInstanceId: drawn } });
        }
        break;
      }
      case 'gain_resource': {
        const amount = Number(p.amount ?? 1);
        inv = { ...inv, resources: inv.resources + amount };
        out.push({ type: 'gain_resource', params: { amount } });
        break;
      }
      case 'deal_damage': {
        const base = Number(p.amount ?? 1);
        // 元素(§6.5 對帶對應狀態的敵人增傷)/ 暴擊倍率 / direct(卡面傷害本就直入 HP,僅敘事旗標)
        const element = p.element != null && p.element !== '' ? String(p.element) : null;
        const critMul = p.crit === true ? 2 : (Number(p.crit) > 1 ? Number(p.crit) : 1);
        const direct = p.direct === true || p.direct === 'true';
        const here = inv.currentLocationId;
        // area = 同地點全體;單體 = 優先與自己交戰的敵人,其次同地點第一隻(ch3 §5.3 enemy_one)
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const engagedFirst = candidates.find((e) => inv.engagedWith.includes(e.instanceId));
        const targets = p.area ? candidates : (engagedFirst ? [engagedFirst] : candidates.slice(0, 1));
        if (targets.length === 0) {
          out.push({ type: 'attack_miss', params: { narrative: '攻擊劃過空蕩的雨幕 — 這裡沒有目標。' } });
          break;
        }
        // 逐敵計傷:元素增傷吃「該敵自身」狀態層數(§6.5),再乘暴擊倍率,命中至少 1
        const dmgFor = (e: typeof targets[number]): number => {
          const elem = element ? elementalDamageBonus(e.statusEffects, element) : 0;
          return Math.max(1, (base + elem) * critMul);
        };
        sc = {
          ...sc,
          enemies: sc.enemies.map((e) => {
            const t = targets.find((x) => x.instanceId === e.instanceId);
            return t ? { ...e, hp: e.hp - dmgFor(e) } : e;
          }),
        };
        for (const t of targets) {
          const d = dmgFor(t);
          out.push({
            type: 'attack_hit',
            params: {
              damage: d,
              element: element ?? undefined,
              crit: critMul > 1 || undefined,
              direct: direct || undefined,
              narrative: p.area ? '範圍攻擊命中' : (critMul > 1 ? '致命一擊撕開了牠的防禦。' : '直擊要害'),
            },
            targetId: t.instanceId,
          });
          if (t.hp - d <= 0) {
            out.push({ type: 'enemy_defeated', params: { narrative: '牠倒下了。' }, targetId: t.instanceId });
          }
        }
        break;
      }
      case 'discover_clue': {
        const amount = Number(p.amount ?? 1);
        sc = {
          ...sc,
          objectiveProgress: sc.objectiveProgress + amount,
          tokens: [
            ...sc.tokens,
            { tokenType: 'clue', locationId: inv.currentLocationId || '', amount },
          ],
        };
        out.push({ type: 'gain_clue', params: { amount } });
        break;
      }
      case 'add_status': {
        const status = String(p.status ?? '');
        // 真實卡面/鍛造詞綴用 stacks 指定層數(優先);layers/amount 為防禦性備援
        const layers = Math.max(1, Number(p.stacks ?? p.layers ?? p.amount ?? 1));
        const toSelf = p.target === 'self';
        if (!status) { unsupported.push('add_status()'); break; }
        // 狀態效果系統(ch3 §6):寫入 statusEffects 層數(由 statusEffects.ts 結算)
        if (toSelf) {
          inv = { ...inv, statusEffects: addStatus(inv.statusEffects, status, layers) };
          out.push({ type: 'status_applied', params: { status, layers, target: 'self' }, targetId: inv.investigatorId });
        } else {
          const targetEnemy = sc.enemies.find((e) => e.hp > 0 && e.locationId === inv.currentLocationId);
          if (targetEnemy) {
            sc = {
              ...sc,
              enemies: sc.enemies.map((e) =>
                e.instanceId === targetEnemy.instanceId
                  ? { ...e, statusEffects: addStatus(e.statusEffects, status, layers) }
                  : e,
              ),
            };
            out.push({ type: 'status_applied', params: { status, layers }, targetId: targetEnemy.instanceId });
          } else {
            unsupported.push('add_status(' + status + ')');
          }
        }
        break;
      }
      case 'search_deck': {
        // 簡化版:檢視牌庫頂 5 張,『探長』系列與線索副類型入手,其餘留在牌庫(不洗)
        const top = inv.deck.slice(0, 5);
        const taken = top.filter((id) => {
          const data = cardLookup[id];
          const name = String(data?.name_zh ?? '');
          const subtypes = Array.isArray(data?.subtypes) ? (data!.subtypes as unknown[]) : [];
          return name.includes('探長') || subtypes.includes('線索');
        });
        inv = {
          ...inv,
          deck: inv.deck.filter((id) => !taken.includes(id)),
          hand: [...inv.hand, ...taken],
        };
        out.push({ type: 'search_deck', params: { viewed: top.length, taken: taken.length } });
        break;
      }
      case 'heal_hp': {
        // 治療 HP(ch3 §7.1):回復當前 HP,夾在上限內(預設 self;盟友定向待 updatedAllies 管線)
        const amount = Number(p.amount ?? 1);
        const healed = Math.min(inv.hpMax, inv.hp + amount) - inv.hp;
        inv = { ...inv, hp: inv.hp + healed };
        out.push({ type: 'heal_hp', params: { amount: healed, narrative: '傷口在你眼前癒合。' }, targetId: inv.investigatorId });
        break;
      }
      case 'heal_san': {
        // 治療 SAN(ch3 §7.1):回復當前理智,夾在上限內
        const amount = Number(p.amount ?? 1);
        const healed = Math.min(inv.sanMax, inv.san + amount) - inv.san;
        inv = { ...inv, san: inv.san + healed };
        out.push({ type: 'heal_san', params: { amount: healed, narrative: '一陣清明壓過了腦中的雜音。' }, targetId: inv.investigatorId });
        break;
      }
      case 'deal_horror': {
        // 玩家卡的 deal_horror:對自身造成 SAN 傷害(禁忌知識/施法代價;敵人無 SAN,故預設 self)
        const amount = Number(p.amount ?? 1);
        inv = { ...inv, san: Math.max(0, inv.san - amount) };
        out.push({ type: 'fear_damage', params: { amount, narrative: '某種不該知道的東西擠進了你的意識。' }, targetId: inv.investigatorId });
        break;
      }
      case 'spend_resource': {
        const amount = Number(p.amount ?? 1);
        inv = { ...inv, resources: Math.max(0, inv.resources - amount) };
        out.push({ type: 'spend_resource', params: { amount } });
        break;
      }
      case 'steal_resource': {
        // 單人範圍:奪取對象(其他調查員)不在本函式可達範圍 → 以自身獲得近似(掠奪環境/敵方資源)
        const amount = Math.max(1, Number(p.amount ?? 1));
        inv = { ...inv, resources: inv.resources + amount };
        out.push({ type: 'steal_resource', params: { amount, narrative: '你順手摸走了能用得上的東西。' } });
        break;
      }
      case 'stun_enemy': {
        // 控場(§10):給目標敵人加 'stunned' 修飾(= monsterActions STUNNED),神話階段該敵跳過啟動一輪
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const engagedFirst = candidates.find((e) => inv.engagedWith.includes(e.instanceId));
        const targets = p.area ? candidates : (engagedFirst ? [engagedFirst] : candidates.slice(0, 1));
        if (targets.length === 0) { unsupported.push('stun_enemy'); break; }
        sc = {
          ...sc,
          enemies: sc.enemies.map((e) =>
            targets.some((t) => t.instanceId === e.instanceId) && !e.modifiers.includes('stunned')
              ? { ...e, modifiers: [...e.modifiers, 'stunned'] }
              : e,
          ),
        };
        for (const t of targets) {
          out.push({ type: 'enemy_stunned', params: { narrative: '你打斷了牠的節奏 — 下一輪牠將無法行動。' }, targetId: t.instanceId });
        }
        break;
      }
      case 'evade': {
        // 閃避(效果碼版):立即脫離與本地點所有敵人的交戰(雙向清),避開藉機攻擊
        const wasEngaged = inv.engagedWith.length;
        if (wasEngaged === 0) {
          out.push({ type: 'evade', params: { narrative: '你拉開了距離 — 這裡沒有什麼纏著你。', disengaged: 0 }, targetId: inv.investigatorId });
          break;
        }
        sc = {
          ...sc,
          enemies: sc.enemies.map((e) =>
            e.engagedWith.includes(inv.investigatorId)
              ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== inv.investigatorId) }
              : e,
          ),
        };
        inv = { ...inv, engagedWith: [] };
        out.push({ type: 'evade', params: { narrative: '你一個側滑脫離了纏鬥。', disengaged: wasEngaged }, targetId: inv.investigatorId });
        break;
      }
      case 'extra_attack': {
        // 額外行動(§3 行動點):給 +amount 行動點,讓本回合可再出手一次(由玩家/AI 決定攻擊)
        const amount = Math.max(1, Number(p.amount ?? 1));
        inv = { ...inv, actionPoints: inv.actionPoints + amount };
        out.push({ type: 'extra_attack', params: { amount, narrative: '腎上腺素湧上 — 你還能再出手。' }, targetId: inv.investigatorId });
        break;
      }
      case 'counterattack': {
        // 反擊(reaction):在自身掛 'counter' 層(= 反擊傷害);神話階段被怪攻擊時由 monsterActions 消耗回敬
        const amount = Math.max(1, Number(p.amount ?? 1));
        inv = { ...inv, statusEffects: addStatus(inv.statusEffects, 'counter', amount) };
        out.push({ type: 'counterattack_armed', params: { amount, narrative: '你擺出架式 — 誰敢撲上來,就先嚐到回敬。' }, targetId: inv.investigatorId });
        break;
      }
      case 'transfer_damage': {
        // 坦克分傷(§10.5 盟友):把傷勢最重盟友的 HP 缺口,最多 amount 點移到自身(盟友回復、自身承受)
        const cap = Math.max(1, Number(p.amount ?? 1));
        const allies = inv.allies ?? [];
        let idx = -1; let gap = 0;
        allies.forEach((a, i) => { const g = a.hpMax - a.hp; if (g > gap) { gap = g; idx = i; } });
        if (idx < 0 || gap <= 0) { unsupported.push('transfer_damage'); break; }
        const moved = Math.min(cap, gap);
        inv = {
          ...inv,
          allies: allies.map((a, i) => (i === idx ? { ...a, hp: a.hp + moved } : a)),
          hp: Math.max(0, inv.hp - moved),
        };
        out.push({ type: 'transfer_damage', params: { amount: moved, ally: allies[idx].name, narrative: '你扛下了同伴身上的傷。' }, targetId: inv.investigatorId });
        break;
      }
      case 'transfer_horror': {
        // 坦克分擔恐懼:把理智耗損最重盟友的 SAN 缺口,最多 amount 點移到自身
        const cap = Math.max(1, Number(p.amount ?? 1));
        const allies = inv.allies ?? [];
        let idx = -1; let gap = 0;
        allies.forEach((a, i) => { const g = a.sanMax - a.san; if (g > gap) { gap = g; idx = i; } });
        if (idx < 0 || gap <= 0) { unsupported.push('transfer_horror'); break; }
        const moved = Math.min(cap, gap);
        inv = {
          ...inv,
          allies: allies.map((a, i) => (i === idx ? { ...a, san: a.san + moved } : a)),
          san: Math.max(0, inv.san - moved),
        };
        out.push({ type: 'transfer_horror', params: { amount: moved, ally: allies[idx].name, narrative: '你接過了同伴眼中的恐懼。' }, targetId: inv.investigatorId });
        break;
      }
      // ─── P1 牌庫/手牌/資產引擎 ───────────────────────
      case 'reveal_top': {
        // 看牌頂 N 張(資訊型:列出,不改區;具體「對揭露牌做什麼」由卡面 search_deck/retrieve 處理)
        const amount = Math.max(1, Number(p.amount ?? 1));
        const top = inv.deck.slice(0, amount);
        out.push({ type: 'reveal_top', params: { count: top.length, cardInstanceIds: top } });
        break;
      }
      case 'discard_card': {
        // 棄牌(MVP 無選牌 UI:棄手牌前 N 張)
        const amount = Math.max(1, Number(p.amount ?? 1));
        const moved = inv.hand.slice(0, amount);
        if (moved.length === 0) { unsupported.push('discard_card'); break; }
        inv = { ...inv, hand: inv.hand.slice(moved.length), discardPile: [...inv.discardPile, ...moved] };
        out.push({ type: 'discard_card', params: { amount: moved.length } });
        break;
      }
      case 'retrieve_card': {
        // 棄牌堆回收(P 流影核心):取最近棄置的 N 張回手
        const amount = Math.max(1, Number(p.amount ?? 1));
        const n = Math.min(amount, inv.discardPile.length);
        if (n === 0) { unsupported.push('retrieve_card'); break; }
        const taken = inv.discardPile.slice(inv.discardPile.length - n);
        inv = { ...inv, discardPile: inv.discardPile.slice(0, inv.discardPile.length - n), hand: [...inv.hand, ...taken] };
        out.push({ type: 'retrieve_card', params: { amount: n } });
        break;
      }
      case 'return_to_deck': {
        // 放回牌庫頂(MVP 無選牌 UI:取手牌前 N 張)
        const amount = Math.max(1, Number(p.amount ?? 1));
        const moved = inv.hand.slice(0, amount);
        if (moved.length === 0) { unsupported.push('return_to_deck'); break; }
        inv = { ...inv, hand: inv.hand.slice(moved.length), deck: [...moved, ...inv.deck] };
        out.push({ type: 'return_to_deck', params: { amount: moved.length } });
        break;
      }
      case 'remove_from_game': {
        // 放逐:優先從棄牌堆移除,棄牌堆空則從手牌 → removedPile
        const amount = Math.max(1, Number(p.amount ?? 1));
        if (inv.discardPile.length > 0) {
          const n = Math.min(amount, inv.discardPile.length);
          const taken = inv.discardPile.slice(inv.discardPile.length - n);
          inv = { ...inv, discardPile: inv.discardPile.slice(0, inv.discardPile.length - n), removedPile: [...inv.removedPile, ...taken] };
          out.push({ type: 'remove_from_game', params: { amount: n, from: 'discard' } });
        } else if (inv.hand.length > 0) {
          const n = Math.min(amount, inv.hand.length);
          const taken = inv.hand.slice(0, n);
          inv = { ...inv, hand: inv.hand.slice(n), removedPile: [...inv.removedPile, ...taken] };
          out.push({ type: 'remove_from_game', params: { amount: n, from: 'hand' } });
        } else {
          unsupported.push('remove_from_game');
        }
        break;
      }
      case 'shuffle_deck': {
        // Fisher-Yates(注入 rng,測試可重現)
        const d = [...inv.deck];
        for (let i = d.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = d[i]; d[i] = d[j]; d[j] = tmp;
        }
        inv = { ...inv, deck: d };
        out.push({ type: 'shuffle_deck', params: { size: d.length } });
        break;
      }
      case 'exhaust_card': {
        // 橫置一張場上資產(ch2 §2.4):取第一張未橫置的
        const st = { ...(inv.assetState ?? {}) };
        const targetId = inv.assetsInPlay.find((id) => !st[id]?.exhausted);
        if (!targetId) { unsupported.push('exhaust_card'); break; }
        st[targetId] = { usesLeft: st[targetId]?.usesLeft ?? null, exhausted: true };
        inv = { ...inv, assetState: st };
        out.push({ type: 'exhaust_card', params: { cardInstanceId: targetId } });
        break;
      }
      case 'ready_card': {
        // 轉正一張橫置資產
        const st = { ...(inv.assetState ?? {}) };
        const targetId = inv.assetsInPlay.find((id) => st[id]?.exhausted);
        if (!targetId) { unsupported.push('ready_card'); break; }
        st[targetId] = { usesLeft: st[targetId]?.usesLeft ?? null, exhausted: false };
        inv = { ...inv, assetState: st };
        out.push({ type: 'ready_card', params: { cardInstanceId: targetId } });
        break;
      }
      case 'gain_use': {
        // 補充消耗次數(ch3 §10.1):給第一張有使用次數的資產 +amount
        const amount = Math.max(1, Number(p.amount ?? 1));
        const st = { ...(inv.assetState ?? {}) };
        const targetId = inv.assetsInPlay.find((id) => st[id] && st[id].usesLeft !== null);
        if (!targetId) { unsupported.push('gain_use'); break; }
        st[targetId] = { usesLeft: (st[targetId].usesLeft ?? 0) + amount, exhausted: st[targetId].exhausted };
        inv = { ...inv, assetState: st };
        out.push({ type: 'gain_use', params: { cardInstanceId: targetId, amount } });
        break;
      }

      // ─── P2 走位/敵控/任務 ───────────────────────
      case 'move_investigator': {
        // 移動自身:有指定地點且合法 → 去那;否則沿連線走 1 格
        const here = sc.locations.find((l) => l.locationDefinitionId === inv.currentLocationId);
        const dest = (p.location ?? p.to ?? p.destination) as string | undefined;
        const target = dest && sc.locations.some((l) => l.locationDefinitionId === dest) ? dest : here?.connectedTo?.[0];
        if (!target || target === inv.currentLocationId) { unsupported.push('move_investigator'); break; }
        const from = inv.currentLocationId;
        // 離開地點 → 與原地點所有敵人脫離交戰(雙向),避免殘留跨地點交戰
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.engagedWith.includes(inv.investigatorId) ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== inv.investigatorId) } : e)) };
        inv = { ...inv, currentLocationId: target, engagedWith: [] };
        out.push({ type: 'move', params: { from, to: target } });
        break;
      }
      case 'move_enemy': {
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const enemyT = candidates.find((e) => inv.engagedWith.includes(e.instanceId)) ?? candidates[0];
        if (!enemyT) { unsupported.push('move_enemy'); break; }
        const loc = sc.locations.find((l) => l.locationDefinitionId === enemyT.locationId);
        const dest = (p.location ?? p.to) as string | undefined;
        const target = dest && sc.locations.some((l) => l.locationDefinitionId === dest) ? dest : loc?.connectedTo?.[0];
        if (!target || target === enemyT.locationId) { unsupported.push('move_enemy'); break; }
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.instanceId === enemyT.instanceId ? { ...e, locationId: target, engagedWith: [] } : e)) };
        inv = { ...inv, engagedWith: inv.engagedWith.filter((id) => id !== enemyT.instanceId) }; // 推離 → 脫離交戰
        out.push({ type: 'move_enemy', params: { from: enemyT.locationId, to: target, enemyId: enemyT.instanceId } });
        break;
      }
      case 'engage_enemy': {
        // 拉怪到自身(taunt/pull):把本人「追加」到敵人交戰名單末位(本人=最近拉怪者)。
        // 單一交戰(§7.2,非 massive)與被搶走的原交戰者脫離,由 ruleEngine reconcileEngagement
        // 依 massive 詞綴對帳(非 massive 只留末位拉怪者,massive 全留)— 此處不可判 massive(無敵資料)
        const here = inv.currentLocationId;
        const enemyT = sc.enemies.find((e) => e.hp > 0 && e.locationId === here && !inv.engagedWith.includes(e.instanceId));
        if (!enemyT) { unsupported.push('engage_enemy'); break; }
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.instanceId === enemyT.instanceId ? { ...e, engagedWith: e.engagedWith.includes(inv.investigatorId) ? e.engagedWith : [...e.engagedWith, inv.investigatorId] } : e)) };
        inv = { ...inv, engagedWith: [...inv.engagedWith, enemyT.instanceId] };
        out.push({ type: 'engage_enemy', params: { enemyId: enemyT.instanceId } });
        break;
      }
      case 'disengage_enemy': {
        if (inv.engagedWith.length === 0) { unsupported.push('disengage_enemy'); break; }
        const count = inv.engagedWith.length;
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.engagedWith.includes(inv.investigatorId) ? { ...e, engagedWith: e.engagedWith.filter((id) => id !== inv.investigatorId) } : e)) };
        inv = { ...inv, engagedWith: [] };
        out.push({ type: 'disengage_enemy', params: { count } });
        break;
      }
      case 'remove_enemy': {
        // 放逐:移出場景(非擊殺,不結算死亡詞綴)
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const enemyT = candidates.find((e) => inv.engagedWith.includes(e.instanceId)) ?? candidates[0];
        if (!enemyT) { unsupported.push('remove_enemy'); break; }
        sc = { ...sc, enemies: sc.enemies.filter((e) => e.instanceId !== enemyT.instanceId) };
        inv = { ...inv, engagedWith: inv.engagedWith.filter((id) => id !== enemyT.instanceId) };
        out.push({ type: 'enemy_removed', params: { enemyId: enemyT.instanceId, narrative: '牠被逐出了這個位面。' }, targetId: enemyT.instanceId });
        break;
      }
      case 'execute_enemy': {
        // 處決:目標 HP 歸 0(擊殺;死亡詞綴需 investigators map,本函式範圍外 → 由容器結算路徑補)
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const enemyT = candidates.find((e) => inv.engagedWith.includes(e.instanceId)) ?? candidates[0];
        if (!enemyT) { unsupported.push('execute_enemy'); break; }
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.instanceId === enemyT.instanceId ? { ...e, hp: 0 } : e)) };
        out.push({ type: 'enemy_defeated', params: { narrative: '一擊斃命 — 牠甚至來不及反應。' }, targetId: enemyT.instanceId });
        break;
      }
      case 'place_clue': {
        // 在地點放線索標記(不直接推進目標進度,供後續調查領取)
        const amount = Math.max(1, Number(p.amount ?? 1));
        const loc = (p.location as string) || inv.currentLocationId || '';
        sc = { ...sc, tokens: [...sc.tokens, { tokenType: 'clue', locationId: loc, amount }] };
        out.push({ type: 'place_clue', params: { amount, location: loc } });
        break;
      }
      case 'place_doom': {
        const amount = Math.max(1, Number(p.amount ?? 1));
        sc = { ...sc, agendaProgress: sc.agendaProgress + amount };
        out.push({ type: 'doom_added', params: { amount, total: sc.agendaProgress, source: '卡片效果' } });
        break;
      }
      case 'remove_doom': {
        const amount = Math.max(1, Number(p.amount ?? 1));
        const before = sc.agendaProgress;
        sc = { ...sc, agendaProgress: Math.max(0, sc.agendaProgress - amount) };
        out.push({ type: 'remove_doom', params: { amount: before - sc.agendaProgress, total: sc.agendaProgress } });
        break;
      }
      case 'add_keyword': {
        const kw = String(p.keyword ?? '');
        if (!kw) { unsupported.push('add_keyword()'); break; }
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const enemyT = candidates.find((e) => inv.engagedWith.includes(e.instanceId)) ?? candidates[0];
        if (!enemyT) { unsupported.push('add_keyword'); break; }
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.instanceId === enemyT.instanceId && !e.modifiers.includes(kw) ? { ...e, modifiers: [...e.modifiers, kw] } : e)) };
        out.push({ type: 'add_keyword', params: { keyword: kw, enemyId: enemyT.instanceId } });
        break;
      }
      case 'remove_keyword': {
        const kw = String(p.keyword ?? '');
        if (!kw) { unsupported.push('remove_keyword()'); break; }
        const here = inv.currentLocationId;
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const enemyT = candidates.find((e) => e.modifiers.includes(kw)) ?? candidates.find((e) => inv.engagedWith.includes(e.instanceId)) ?? candidates[0];
        if (!enemyT) { unsupported.push('remove_keyword'); break; }
        sc = { ...sc, enemies: sc.enemies.map((e) => (e.instanceId === enemyT.instanceId ? { ...e, modifiers: e.modifiers.filter((m) => m !== kw) } : e)) };
        out.push({ type: 'remove_keyword', params: { keyword: kw, enemyId: enemyT.instanceId } });
        break;
      }

      case 'modify_test':
      case 'wild_attr_boost':
        // 檢定時機修正:於 resolveCheck 由 passiveTestModifier 聚合
        //(modify_test 指定屬性 +modifier / wild_attr_boost 全屬性 +amount);action 路徑不結算
        break;
      case 'reroll':
      case 'auto_success':
      case 'auto_fail':
        // 檢定反應碼(on_fail/on_success 時機):反應觸發管線待補;action 路徑暫不結算(不報 unsupported 避免洗 log)
        break;
      // ─── P3 環境(光照/火/鬧鬼/連線)— 已被引擎消費的部分 ────
      case 'create_darkness':
      case 'create_fire':
      case 'create_light':
      case 'extinguish_fire':
      case 'extinguish_light':
      case 'remove_darkness': {
        // 改地點視野(§第五章 §7;visibilityModifier 消費):光→day / 暗→darkness / 火→fire / 滅燈→night
        const loc = (p.location as string) || inv.currentLocationId || '';
        if (!sc.locations.some((l) => l.locationDefinitionId === loc)) { unsupported.push(code); break; }
        const vis: 'day' | 'night' | 'darkness' | 'fire' =
          code === 'create_darkness' ? 'darkness'
            : code === 'create_fire' ? 'fire'
              : code === 'extinguish_light' ? 'night'
                : 'day'; // create_light / remove_darkness / extinguish_fire
        sc = { ...sc, locations: sc.locations.map((l) => (l.locationDefinitionId === loc ? { ...l, visibility: vis } : l)) };
        out.push({ type: 'visibility_changed', params: { location: loc, visibility: vis } });
        break;
      }
      case 'place_haunting': {
        // 鬧鬼附著地點(§11.3;reviveHaunting 消費):需指定復活的怪物定義
        const enemyDef = String(p.enemy ?? p.enemyDefinitionId ?? '');
        const loc = (p.location as string) || inv.currentLocationId || '';
        if (!enemyDef || !loc) { unsupported.push('place_haunting'); break; }
        sc = { ...sc, hauntings: [...(sc.hauntings ?? []), { locationId: loc, enemyDefinitionId: enemyDef }] };
        out.push({ type: 'place_haunting', params: { location: loc, enemy: enemyDef } });
        break;
      }
      case 'remove_haunting': {
        const loc = (p.location as string) || inv.currentLocationId || '';
        const before = (sc.hauntings ?? []).length;
        const next = (sc.hauntings ?? []).filter((h) => h.locationId !== loc);
        if (next.length === before) { unsupported.push('remove_haunting'); break; }
        sc = { ...sc, hauntings: next };
        out.push({ type: 'remove_haunting', params: { location: loc } });
        break;
      }
      case 'connect_tiles': {
        // 連通兩地點(connectedTo 雙向;尋路消費)
        const a = (p.from as string) || inv.currentLocationId || '';
        const b = (p.to as string) || (p.location as string) || '';
        const ok = a && b && a !== b && sc.locations.some((l) => l.locationDefinitionId === a) && sc.locations.some((l) => l.locationDefinitionId === b);
        if (!ok) { unsupported.push('connect_tiles'); break; }
        sc = { ...sc, locations: sc.locations.map((l) => {
          if (l.locationDefinitionId === a && !l.connectedTo.includes(b)) return { ...l, connectedTo: [...l.connectedTo, b] };
          if (l.locationDefinitionId === b && !l.connectedTo.includes(a)) return { ...l, connectedTo: [...l.connectedTo, a] };
          return l;
        }) };
        out.push({ type: 'connect_tiles', params: { from: a, to: b } });
        break;
      }
      case 'disconnect_tiles': {
        const a = (p.from as string) || inv.currentLocationId || '';
        const b = (p.to as string) || (p.location as string) || '';
        if (!a || !b) { unsupported.push('disconnect_tiles'); break; }
        sc = { ...sc, locations: sc.locations.map((l) => {
          if (l.locationDefinitionId === a) return { ...l, connectedTo: l.connectedTo.filter((x) => x !== b) };
          if (l.locationDefinitionId === b) return { ...l, connectedTo: l.connectedTo.filter((x) => x !== a) };
          return l;
        }) };
        out.push({ type: 'disconnect_tiles', params: { from: a, to: b } });
        break;
      }
      case 'reveal_tile':
      case 'place_tile':
      case 'remove_tile':
        // G4 隨機地城 tile 系統尚未建模(場景為固定地點非 tile)→ 明確回報待 G4,不靜默
        unsupported.push(code);
        break;

      case 'attack':
        // 武器攻擊走 ruleEngine 路徑
        break;
      case 'remove_status': {
        // ch3 §6:移除自身狀態。指定 status → 移除該狀態;否則淨化所有負面(驅邪儀式等)
        const specific = String(p.status ?? '');
        let map = inv.statusEffects ?? {};
        if (specific) {
          map = removeStatus(map, specific);
        } else {
          for (const code of NEGATIVE_STATUSES) map = removeStatus(map, code);
        }
        inv = { ...inv, statusEffects: map };
        out.push({ type: 'status_cleansed', params: { status: specific || 'all_negative', narrative: '一道淨化掃過你的身體。' }, targetId: inv.investigatorId });
        break;
      }
      default:
        unsupported.push(code);
    }
  }
  return { investigator: inv, scenario: sc, effects: out, unsupported };
}

/**
 * 軸向連動條件評估(s08–s10 軸向 COMBO):同軸卡狀態滿足才讓 combo 效果結算。
 * condition 形狀(Gemini 寫進 effect_params.condition):{ axis_value, scope, min }
 *  - scope='in_play':場上(assetsInPlay)同軸卡數 ≥ min(持續「場上有 N 張 X」/ 條件「有 X 時」)
 *  - scope='played_this_turn':本回合已打出同軸卡數 ≥ min — 需回合級軸計數(Phase A-2 接 ruleEngine),暫不啟用
 * 無 axis_value → 不擋(回 true);無法評估的 scope → 不啟用(回 false,combo 不生效,基礎效果不受影響)。
 */
export function axisConditionMet(
  condition: Record<string, unknown>,
  investigator: InvestigatorState,
  cardLookup: CardDataLookup,
): boolean {
  const axisValue = String(condition?.axis_value ?? '');
  if (!axisValue) return true;
  const min = Math.max(1, Number(condition?.min ?? 1));
  const scope = String(condition?.scope ?? 'in_play');
  if (scope === 'in_play') {
    const count = investigator.assetsInPlay.filter(
      (id) => String(cardLookup[id]?.primary_axis_value ?? '') === axisValue,
    ).length;
    return count >= min;
  }
  return false;
}

/**
 * 被動檢定修正聚合(§8 / 卡面被動):
 * 掃描場上資產的 passive modify_test 效果,params.attribute 對上本次檢定屬性才算。
 */
export function passiveTestModifier(
  investigator: InvestigatorState,
  cardLookup: CardDataLookup,
  attribute: string,
): number {
  let sum = 0;
  for (const assetId of investigator.assetsInPlay) {
    const data = cardLookup[assetId];
    for (const fx of (data?.effects ?? []) as CardEffectRow[]) {
      if (fx.trigger_type !== 'passive') continue;
      const p = (fx.effect_params ?? {}) as Record<string, any>;
      if (fx.effect_code === 'modify_test') {
        // 指定屬性 +modifier(限定本次檢定屬性才算)
        if (String(p.attribute ?? '') === attribute) sum += Number(p.modifier ?? 0);
      } else if (fx.effect_code === 'wild_attr_boost') {
        // 全屬性/全技能 +amount(§5.5):任何屬性檢定都加(Key of Ys 型)
        sum += Number(p.amount ?? 0);
      }
    }
  }
  return sum;
}
