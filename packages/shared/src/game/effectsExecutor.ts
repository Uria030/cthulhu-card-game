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
        const amount = Number(p.amount ?? 1);
        const here = inv.currentLocationId;
        // area = 同地點全體;單體 = 優先與自己交戰的敵人,其次同地點第一隻(ch3 §5.3 enemy_one)
        const candidates = sc.enemies.filter((e) => e.hp > 0 && e.locationId === here);
        const engagedFirst = candidates.find((e) => inv.engagedWith.includes(e.instanceId));
        const targets = p.area ? candidates : (engagedFirst ? [engagedFirst] : candidates.slice(0, 1));
        if (targets.length === 0) {
          out.push({ type: 'attack_miss', params: { narrative: '攻擊劃過空蕩的雨幕 — 這裡沒有目標。' } });
          break;
        }
        sc = {
          ...sc,
          enemies: sc.enemies.map((e) =>
            targets.some((t) => t.instanceId === e.instanceId) ? { ...e, hp: e.hp - amount } : e,
          ),
        };
        for (const t of targets) {
          out.push({ type: 'attack_hit', params: { damage: amount, narrative: p.area ? '範圍攻擊命中' : '直擊要害' }, targetId: t.instanceId });
          if (t.hp - amount <= 0) {
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
        const targetEnemy = sc.enemies.find(
          (e) => e.hp > 0 && e.locationId === inv.currentLocationId,
        );
        // 首批:對敵狀態(標記等)→ 記入 modifiers;對己狀態(證物堆疊)後續批次
        if (status && targetEnemy) {
          sc = {
            ...sc,
            enemies: sc.enemies.map((e) =>
              e.instanceId === targetEnemy.instanceId
                ? { ...e, modifiers: [...e.modifiers, status] }
                : e,
            ),
          };
          out.push({ type: 'status_applied', params: { status }, targetId: targetEnemy.instanceId });
        } else {
          unsupported.push('add_status(self/' + status + ')');
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
      case 'modify_test':
        // passive 聚合於檢定時;on_commit 與 commit_icons 重複 — 都不在此執行
        break;
      case 'attack':
        // 武器攻擊走 ruleEngine 路徑
        break;
      case 'remove_status': {
        // 最小版(ch3 §6):移除自身所有負面附著(驅邪儀式等)— v0 以敘事表示,
        // 狀態系統結算接通後改為實際移除層數
        out.push({ type: 'status_cleansed', params: { narrative: '一道淨化掃過你的身體。' } });
        break;
      }
      default:
        unsupported.push(code);
    }
  }
  return { investigator: inv, scenario: sc, effects: out, unsupported };
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
      if (fx.trigger_type !== 'passive' || fx.effect_code !== 'modify_test') continue;
      const p = (fx.effect_params ?? {}) as Record<string, any>;
      if (String(p.attribute ?? '') === attribute) {
        sum += Number(p.modifier ?? 0);
      }
    }
  }
  return sum;
}
