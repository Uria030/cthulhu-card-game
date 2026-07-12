import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from '@cthulhu/shared';
import type {
  IntentMessage,
  MultiplayerPrivateState,
  MultiplayerRoomSnapshot,
  MultiplayerServerMessage,
} from '@cthulhu/shared';
import {
  fetchMultiplayerPrivateState,
  fetchMultiplayerRoom,
  fetchPlayerMe,
  getPlayerToken,
} from '../api';
import { cinematicFromResolved, advanceCinematic, type MultiplayerCinematic } from '../game/multiplayerCinematic';
import { openMultiplayerTransport, type MultiplayerTransport } from '../game/multiplayerTransport';
import './MultiplayerScenarioScreen.css';

const CHECK_ACTIONS = new Set<IntentMessage['actionType']>([
  'investigate', 'search', 'attack', 'evade', 'execute_card_action',
]);

function effectLine(message: MultiplayerServerMessage): string | null {
  if (message.type === 'intent_resolved') {
    const effects = message.result.effects ?? [];
    return effects.length > 0
      ? effects.map((effect) => effect.type).join('、')
      : message.result.rejection?.narrative ?? '行動已由伺服器裁決。';
  }
  if (message.type === 'ai_turn_completed') return message.lines.length > 0 ? `AI:${message.lines.join('、')}` : 'AI 已結束本回合。';
  if (message.type === 'phase_changed') return message.phase === 'mythos' ? '有神秘的事情發生了！' : '新的調查員回合開始。';
  return null;
}

function commitLabel(icons: Record<string, number>): string {
  const entries = Object.entries(icons).filter(([, value]) => Number(value) > 0);
  return entries.length === 0 ? '' : entries.map(([key, value]) => `${key}+${value}`).join(' ');
}

function cardTypeLabel(cardType: string): string {
  return ({ asset: '資產', event: '事件', ally: '盟友', skill: '技能', weakness: '弱點' } as Record<string, string>)[cardType] ?? '未知類型';
}

export function MultiplayerScenarioScreen() {
  const navigate = useNavigate();
  const { roomCode = '' } = useParams();
  const [snapshot, setSnapshot] = useState<MultiplayerRoomSnapshot | null>(null);
  const [privateState, setPrivateState] = useState<MultiplayerPrivateState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [notice, setNotice] = useState('正在建立權威連線……');
  const [log, setLog] = useState<string[]>([]);
  const [cinematics, setCinematics] = useState<MultiplayerCinematic[]>([]);
  const [commitIds, setCommitIds] = useState<string[]>([]);
  const [pendingSequence, setPendingSequence] = useState<number | null>(null);
  const transportRef = useRef<MultiplayerTransport | null>(null);
  const sequenceRef = useRef(1);
  const playerIdRef = useRef<string | null>(null);
  const pendingSequenceRef = useRef<number | null>(null);

  useEffect(() => {
    const token = getPlayerToken();
    if (!token) { navigate('/saves', { replace: true }); return; }
    let cancelled = false;
    const adopt = (next: MultiplayerRoomSnapshot) => {
      setSnapshot(next);
      const currentPlayerId = playerIdRef.current;
      if (currentPlayerId) sequenceRef.current = next.nextSequenceByPlayer?.[currentPlayerId] ?? sequenceRef.current;
    };
    Promise.all([fetchPlayerMe(), fetchMultiplayerRoom(roomCode)])
      .then(([me, room]) => {
        if (cancelled) return;
        setPlayerId(me.player.id);
        playerIdRef.current = me.player.id;
        sequenceRef.current = room.nextSequenceByPlayer?.[me.player.id] ?? 1;
        adopt(room);
      })
      .catch((error: unknown) => !cancelled && setNotice(error instanceof Error ? error.message : String(error)));
    const onMessage = (message: MultiplayerServerMessage) => {
      const line = effectLine(message);
      if (line) setLog((current) => [...current.slice(-19), line]);
      if (message.type === 'intent_resolved') {
        const currentPlayerId = playerIdRef.current;
        const viewerId = currentPlayerId ? message.snapshot.game?.playerInvestigators[currentPlayerId] ?? null : null;
        const cinematic = cinematicFromResolved(message, viewerId);
        if (cinematic) setCinematics((current) => current.some((item) => item.id === cinematic.id) ? current : [...current, cinematic]);
        if (message.actorPlayerId === currentPlayerId && message.sequence === pendingSequenceRef.current) {
          pendingSequenceRef.current = null;
          setPendingSequence(null);
        }
      }
      if (message.type === 'room_snapshot' || message.type === 'intent_resolved' || message.type === 'ai_turn_completed' || message.type === 'phase_changed') {
        adopt(message.snapshot);
      } else if (message.type === 'room_closed') {
        navigate('/multiplayer', { replace: true });
      } else if (message.type === 'error') {
        setNotice(message.message);
        pendingSequenceRef.current = null;
        setPendingSequence(null);
        if (message.snapshot) adopt(message.snapshot);
      }
    };
    transportRef.current = openMultiplayerTransport({
      roomCode, token, onMessage,
      onClose: () => setNotice('連線暫時中斷；重連後會取得完整快照。'),
    });
    return () => { cancelled = true; transportRef.current?.close(); transportRef.current = null; };
  }, [navigate, roomCode]);

  useEffect(() => {
    if (!snapshot?.game || !playerId) return;
    let cancelled = false;
    fetchMultiplayerPrivateState(roomCode)
      .then((next) => { if (!cancelled) setPrivateState(next); })
      .catch((error: unknown) => !cancelled && setNotice(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [playerId, roomCode, snapshot?.version, snapshot?.game]);

  const game = snapshot?.game;
  const myInvestigatorId = playerId && game ? game.playerInvestigators[playerId] : null;
  const investigator = myInvestigatorId ? game?.investigators[myInvestigatorId] : null;
  const isAiControlled = !!(myInvestigatorId && game?.controllerByInvestigator[myInvestigatorId] === 'ai');
  const declared = !!(myInvestigatorId && game?.declaredEndByInvestigator.includes(myInvestigatorId));
  const activeCinematic = cinematics[0] ?? null;
  const encounterBlocked = activeCinematic?.blocksActor === true;
  const canAct = !!game && game.scenario.phase === 'investigator' && !isAiControlled && !declared && !encounterBlocked && pendingSequence === null;

  const toggleCommit = (cardId: string) => setCommitIds((current) => (
    current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]
  ));

  const send = (actionType: IntentMessage['actionType'], payload: Record<string, unknown> = {}) => {
    if (!transportRef.current || !playerId || !investigator || !canAct) return;
    const sequence = sequenceRef.current++;
    const checkedPayload = CHECK_ACTIONS.has(actionType) && commitIds.length > 0
      ? { ...payload, commitCardIds: commitIds }
      : payload;
    const accepted = transportRef.current.sendIntent(sequence, {
      id: `mp-${roomCode}-${sequence}`,
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: playerId,
      kind: 'intent',
      playerId,
      investigatorId: investigator.investigatorId,
      actionType,
      payload: checkedPayload,
    });
    if (!accepted) {
      sequenceRef.current -= 1;
      setNotice('連線尚未就緒。');
      return;
    }
    setPendingSequence(sequence);
    pendingSequenceRef.current = sequence;
    if (CHECK_ACTIONS.has(actionType)) setCommitIds([]);
  };

  const declareEnd = () => {
    if (!transportRef.current || !canAct) return;
    const sequence = sequenceRef.current++;
    if (!transportRef.current.declareActionEnd(sequence)) {
      sequenceRef.current -= 1;
      setNotice('連線尚未就緒。');
      return;
    }
    setPendingSequence(sequence);
    pendingSequenceRef.current = sequence;
  };

  const advancePresentation = () => setCinematics((current) => {
    const active = current[0];
    if (!active) return current;
    const next = advanceCinematic(active);
    return next ? [next, ...current.slice(1)] : current.slice(1);
  });

  if (!snapshot || !game || !investigator) return <main className="mps-root"><p>{notice}</p></main>;

  const enemiesHere = game.scenario.enemies.filter((enemy) => enemy.hp > 0 && enemy.locationId === investigator.currentLocationId);
  const downedAllies = Object.values(game.investigators).filter((member) => (
    member.investigatorId !== investigator.investigatorId
    && member.currentLocationId === investigator.currentLocationId
    && member.downed === true
  ));
  const canSearch = (game.scenario.discoverablePools ?? []).some((pool) => (
    pool.locationId === investigator.currentLocationId && pool.takenBy === null
  ));

  return <main className="mps-root">
    <header className="mps-header">
      <button onClick={() => navigate(`/multiplayer/${roomCode}`)}>房間</button>
      <div><small>權威多人房 {snapshot.roomCode}</small><h1>{game.stageId ? '雨夜的真相' : '多人調查'}</h1></div>
      <div className="mps-phase">T{game.turn.turnNumber} · {game.scenario.phase === 'investigator' ? '調查員階段' : '神話階段'}</div>
    </header>

    <aside className="mps-party">
      {Object.values(game.investigators).map((member) => <div className={member.investigatorId === investigator.investigatorId ? 'is-self' : ''} key={member.investigatorId}>
        <strong>{member.investigatorId === investigator.investigatorId ? '你' : member.investigatorId}</strong>
        <span>HP {member.hp}/{member.hpMax} · SAN {member.san}/{member.sanMax} · AP {member.actionPoints}</span>
        <small>{game.controllerByInvestigator[member.investigatorId] === 'ai' ? 'AI 控制' : '真人控制'}</small>
      </div>)}
    </aside>

    <section className="mps-map" aria-label="地圖">
      {game.scenario.locations.map((location) => {
        const isHere = investigator.currentLocationId === location.locationDefinitionId;
        const canMove = !isHere && investigator.actionPoints > 0 && location.connectedTo.includes(investigator.currentLocationId ?? '');
        const clues = game.scenario.tokens
          .filter((token) => token.locationId === location.locationDefinitionId && token.tokenType === 'clue')
          .reduce((sum, token) => sum + token.amount, 0);
        return <article className={isHere ? 'is-here' : ''} key={location.locationDefinitionId}>
          <h2>{location.locationDefinitionId}</h2><p>線索 {clues}</p>
          {isHere && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('investigate')}>調查此地點</button>}
          {canMove && <button disabled={!canAct} onClick={() => send('move', { targetLocationId: location.locationDefinitionId })}>移動到此</button>}
          {isHere && enemiesHere.map((enemy) => <div className="mps-enemy" key={enemy.instanceId}>
            <span>{enemy.enemyDefinitionId} · HP {enemy.hp}</span>
            <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('attack', { enemyInstanceId: enemy.instanceId })}>攻擊</button>
            {investigator.engagedWith.includes(enemy.instanceId) && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('evade', { enemyInstanceId: enemy.instanceId })}>閃避</button>}
          </div>)}
        </article>;
      })}
    </section>

    <section className="mps-actions" aria-label="行動列">
      <div><strong>你的狀態</strong><span>資源 {investigator.resources} · 手牌 {investigator.hand.length} · 牌庫 {investigator.deck.length} · 棄牌 {investigator.discardPile.length}</span></div>
      <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('gain_resource')}>拿資源</button>
      <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('draw_card')}>抽卡</button>
      {canSearch && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('search')}>搜尋</button>}
      {enemiesHere.length > 0 && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('taunt')}>挑釁</button>}
      {downedAllies.map((ally) => <button disabled={!canAct || investigator.actionPoints < 1} key={ally.investigatorId} onClick={() => send('stabilize', { targetInvestigatorId: ally.investigatorId })}>穩定 {ally.investigatorId}</button>)}
      {investigator.allies?.filter((ally) => !ally.exhausted && ally.attack > 0).map((ally) => enemiesHere.map((enemy) => <button disabled={!canAct || investigator.actionPoints < 1} key={`${ally.cardInstanceId}-${enemy.instanceId}`} onClick={() => send('ally_attack', { allyInstanceId: ally.cardInstanceId, enemyInstanceId: enemy.instanceId })}>{ally.name} 攻擊</button>))}
      <button className="mps-end" disabled={!canAct} onClick={declareEnd}>{isAiControlled ? 'AI 正在代打' : declared ? '已宣告結束' : pendingSequence !== null ? '等待裁決' : '結束行動'}</button>
    </section>

    <section className="mps-hand" aria-label="你的手牌">
      <header><h2>手牌與檢定投入</h2><span>{commitIds.length > 0 ? `已選 ${commitIds.length} 張投入` : '未選投入卡'}</span></header>
      {privateState?.hand.length ? <div className="mps-card-grid">{privateState.hand.map((card) => {
        const commit = commitLabel(card.commitIcons);
        const canPlay = !['skill', 'weakness'].includes(card.cardType);
        return <article className="mps-card" key={card.instanceId}>
          <strong>{card.nameZh}</strong><small>{cardTypeLabel(card.cardType)} · 費用 {card.cost}</small>
          {commit && <button className={commitIds.includes(card.instanceId) ? 'is-selected' : ''} disabled={!canAct} onClick={() => toggleCommit(card.instanceId)} aria-pressed={commitIds.includes(card.instanceId)}>投入 {commit}</button>}
          {canPlay && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('play_card', { cardInstanceId: card.instanceId })}>打出</button>}
          {card.canConsume && <button disabled={!canAct || investigator.actionPoints < 1} onClick={() => send('consume', { cardInstanceId: card.instanceId })}>消費</button>}
        </article>;
      })}</div> : <p>手牌資料載入中，或目前沒有手牌。</p>}
      {privateState?.assets.length ? <div className="mps-card-grid mps-assets">{privateState.assets.map((card) => <article className="mps-card" key={card.instanceId}>
        <strong>{card.nameZh}</strong><small>場上資產{card.usesLeft == null ? '' : ` · 使用 ${card.usesLeft}`}</small>
        {Array.from({ length: card.actionCount }, (_, index) => <button disabled={!canAct || investigator.actionPoints < 1} key={index} onClick={() => send('execute_card_action', { cardInstanceId: card.instanceId, actionIndex: index, ...(enemiesHere[0] ? { enemyInstanceId: enemiesHere[0].instanceId } : {}) })}>使用行動 {index + 1}</button>)}
      </article>)}</div> : null}
    </section>

    <aside className="mps-log"><h2>戰役紀錄</h2>{log.length === 0 ? <p>等待第一個權威事件。</p> : log.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</aside>

    {activeCinematic && <section className={'mps-cinematic' + (activeCinematic.blocksActor ? ' is-blocking' : '')} aria-live="polite">
      <small>{activeCinematic.actorPlayerId === playerId ? '你的行動演出' : '隊友的行動演出'} · 第 {activeCinematic.beat} 幕</small>
      <h2>{activeCinematic.title}</h2>
      {activeCinematic.beat === 1 && <p>{activeCinematic.blocksActor ? '這個遭遇正在等待你的處置；其他調查員不受影響。' : '權威結果已送達；這段演出只在你的裝置播放。'}</p>}
      {activeCinematic.beat === 2 && <p>{activeCinematic.hasCheck ? activeCinematic.lines.find((line) => line.startsWith('檢定')) ?? '檢定結果已由伺服器裁決。' : '此行動沒有檢定，結果即將揭露。'}</p>}
      {activeCinematic.beat === 3 && <div>{activeCinematic.lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>}
      <button onClick={advancePresentation}>{activeCinematic.beat === 3 ? '收起演出' : '下一幕'}</button>
    </section>}

    {game.resolution && <p className="mps-notice" role="status">章節結局 {game.resolution.outcomeCode}：{game.resolution.status === 'saved' ? '已寫入所有真人存檔' : game.resolution.status === 'pending' ? '正在寫入存檔' : '存檔寫入失敗，請保留戰役紀錄回報'}</p>}
    {!game.resolution && notice && <p className="mps-notice" role="status">{notice}</p>}
  </main>;
}
