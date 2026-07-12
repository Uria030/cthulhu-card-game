import type { MultiplayerIntentResolvedMessage, ResultEffect } from '@cthulhu/shared';

export interface MultiplayerCinematic {
  id: string;
  actorPlayerId: string;
  title: string;
  beat: 1 | 2 | 3;
  hasCheck: boolean;
  blocksActor: boolean;
  lines: string[];
}

function titleFor(effects: ResultEffect[]): string {
  const types = new Set(effects.map((effect) => effect.type));
  if (types.has('encounter_drawn') || types.has('encounter_narrative')) return '遭遇正在展開';
  if (types.has('play_card') || types.has('card_action') || types.has('card_consumed')) return '卡片的力量被喚醒';
  if (types.has('attack') || types.has('style_card_drawn') || types.has('enemy_damaged')) return '戰鬥爆發';
  if (types.has('move')) return '你踏入了新的地點';
  if (types.has('investigate') || types.has('gain_clue')) return '調查有了回音';
  if (types.has('draw_card')) return '新的線索落入手中';
  if (types.has('gain_resource')) return '你整理了手邊資源';
  return '行動結果已送達';
}

function lineFor(effect: ResultEffect): string {
  const params = effect.params ?? {};
  const name = String(params.name ?? params.enemy ?? params.title ?? '');
  if (effect.type === 'roll_d20') {
    return `檢定 d20=${String(params.roll ?? '?')}，總值 ${String(params.total ?? '?')} 對 DC ${String(params.dc ?? '?')}`;
  }
  if (effect.type === 'encounter_drawn') return `遭遇「${name || '未知異象'}」`;
  if (effect.type === 'play_card' || effect.type === 'card_action' || effect.type === 'card_consumed') return `${name || '卡片'} 已結算`;
  if (effect.type === 'move') return `移動至 ${String(params.to ?? '下一個地點')}`;
  if (effect.type === 'gain_clue') return `獲得 ${String(params.amount ?? 0)} 線索`;
  if (effect.type === 'gain_resource') return `獲得 ${String(params.amount ?? 1)} 資源`;
  if (effect.type === 'draw_card') return `抽到「${name || String(params.cardInstanceId ?? '一張卡')}」`;
  if (effect.type === 'damage_dealt' || effect.type === 'enemy_damaged') return `${name || '目標'} 受到 ${String(params.amount ?? params.damage ?? 0)} 傷害`;
  if (effect.type === 'fear_damage') return `承受 ${String(params.amount ?? 0)} 恐懼`;
  if (effect.type === 'spend_action_point') return `花費 ${String(params.amount ?? 1)} 行動點`;
  return String(params.narrative ?? effect.type);
}

export function cinematicFromResolved(
  message: MultiplayerIntentResolvedMessage,
  viewerInvestigatorId: string | null,
): MultiplayerCinematic | null {
  if (message.result.outcome !== 'accepted') return null;
  const effects = message.result.effects ?? [];
  if (effects.length === 0) return null;
  const encounterTargets = effects
    .filter((effect) => effect.type === 'encounter_drawn' || effect.type === 'encounter_narrative')
    .map((effect) => effect.targetId)
    .filter((targetId): targetId is string => typeof targetId === 'string');
  return {
    id: `${message.actorPlayerId}:${message.sequence}:${message.result.inResponseTo}`,
    actorPlayerId: message.actorPlayerId,
    title: titleFor(effects),
    beat: 1,
    hasCheck: effects.some((effect) => effect.type === 'roll_d20'),
    // Only a future server-issued encounter targeting this investigator may
    // pause this local player's controls. Other clients keep acting normally.
    blocksActor: !!viewerInvestigatorId && encounterTargets.includes(viewerInvestigatorId),
    lines: effects.map(lineFor),
  };
}

export function advanceCinematic(cinematic: MultiplayerCinematic): MultiplayerCinematic | null {
  if (cinematic.beat === 3) return null;
  return { ...cinematic, beat: (cinematic.beat + 1) as 2 | 3 };
}
