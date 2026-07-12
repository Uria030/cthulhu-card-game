import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CURRENT_MESSAGE_SCHEMA_VERSION } from '@cthulhu/shared';
import type { IntentMessage, MultiplayerRoomSnapshot, MultiplayerServerMessage } from '@cthulhu/shared';
import { fetchMultiplayerRoom, fetchPlayerMe, getPlayerToken } from '../api';
import { openMultiplayerTransport, type MultiplayerTransport } from '../game/multiplayerTransport';
import './MultiplayerScenarioScreen.css';

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

export function MultiplayerScenarioScreen() {
  const navigate = useNavigate();
  const { roomCode = '' } = useParams();
  const [snapshot, setSnapshot] = useState<MultiplayerRoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [notice, setNotice] = useState('正在建立權威連線……');
  const [log, setLog] = useState<string[]>([]);
  const transportRef = useRef<MultiplayerTransport | null>(null);
  const sequenceRef = useRef(1);

  useEffect(() => {
    const token = getPlayerToken();
    if (!token) { navigate('/saves', { replace: true }); return; }
    let cancelled = false;
    const adopt = (next: MultiplayerRoomSnapshot) => {
      setSnapshot(next);
      if (playerId) sequenceRef.current = next.nextSequenceByPlayer?.[playerId] ?? sequenceRef.current;
    };
    Promise.all([fetchPlayerMe(), fetchMultiplayerRoom(roomCode)])
      .then(([me, room]) => {
        if (cancelled) return;
        setPlayerId(me.player.id);
        sequenceRef.current = room.nextSequenceByPlayer?.[me.player.id] ?? 1;
        adopt(room);
      })
      .catch((error: unknown) => !cancelled && setNotice(error instanceof Error ? error.message : String(error)));
    const onMessage = (message: MultiplayerServerMessage) => {
      const line = effectLine(message);
      if (line) setLog((current) => [...current.slice(-19), line]);
      if (message.type === 'room_snapshot' || message.type === 'intent_resolved' || message.type === 'ai_turn_completed' || message.type === 'phase_changed') {
        adopt(message.snapshot);
      } else if (message.type === 'room_closed') {
        navigate('/multiplayer', { replace: true });
      } else if (message.type === 'error') {
        setNotice(message.message);
        if (message.snapshot) adopt(message.snapshot);
      }
    };
    transportRef.current = openMultiplayerTransport({ roomCode, token, onMessage, onClose: () => setNotice('連線暫時中斷；重連後會取得完整快照。') });
    return () => { cancelled = true; transportRef.current?.close(); transportRef.current = null; };
  }, [navigate, playerId, roomCode]);

  const game = snapshot?.game;
  const myInvestigatorId = playerId && game ? game.playerInvestigators[playerId] : null;
  const investigator = myInvestigatorId ? game?.investigators[myInvestigatorId] : null;
  const isAiControlled = !!(myInvestigatorId && game?.controllerByInvestigator[myInvestigatorId] === 'ai');
  const declared = !!(myInvestigatorId && game?.declaredEndByInvestigator.includes(myInvestigatorId));

  const send = (actionType: IntentMessage['actionType'], payload: Record<string, unknown> = {}) => {
    if (!transportRef.current || !playerId || !investigator || isAiControlled || declared) return;
    const sequence = sequenceRef.current++;
    const accepted = transportRef.current.sendIntent(sequence, {
      id: `mp-${roomCode}-${sequence}`,
      timestamp: new Date().toISOString(),
      schemaVersion: CURRENT_MESSAGE_SCHEMA_VERSION,
      source: playerId,
      kind: 'intent',
      playerId,
      investigatorId: investigator.investigatorId,
      actionType,
      payload,
    });
    if (!accepted) { sequenceRef.current -= 1; setNotice('連線尚未就緒。'); }
  };
  const declareEnd = () => {
    if (!transportRef.current || isAiControlled || declared) return;
    const sequence = sequenceRef.current++;
    if (!transportRef.current.declareActionEnd(sequence)) { sequenceRef.current -= 1; setNotice('連線尚未就緒。'); }
  };

  if (!snapshot || !game || !investigator) return <main className="mps-root"><p>{notice}</p></main>;

  return <main className="mps-root"><header className="mps-header"><button onClick={() => navigate(`/multiplayer/${roomCode}`)}>房間</button><div><small>權威多人房 {snapshot.roomCode}</small><h1>{game.stageId ? '雨夜的真相' : '多人調查'}</h1></div><div className="mps-phase">T{game.turn.turnNumber} · {game.scenario.phase === 'investigator' ? '調查員階段' : '神話階段'}</div></header>
    <aside className="mps-party">{Object.values(game.investigators).map((member) => <div className={member.investigatorId === investigator.investigatorId ? 'is-self' : ''} key={member.investigatorId}><strong>{member.investigatorId === investigator.investigatorId ? '你' : member.investigatorId}</strong><span>HP {member.hp}/{member.hpMax} · SAN {member.san}/{member.sanMax} · AP {member.actionPoints}</span><small>{game.controllerByInvestigator[member.investigatorId] === 'ai' ? 'AI 控制' : '真人控制'}</small></div>)}</aside>
    <section className="mps-map" aria-label="地圖">{game.scenario.locations.map((location) => {
      const isHere = investigator.currentLocationId === location.locationDefinitionId;
      const canMove = !isHere && investigator.actionPoints > 0 && location.connectedTo.includes(investigator.currentLocationId ?? '');
      return <article className={isHere ? 'is-here' : ''} key={location.locationDefinitionId}><h2>{location.locationDefinitionId}</h2><p>線索 {game.scenario.tokens.filter((token) => token.locationId === location.locationDefinitionId && token.tokenType === 'clue').reduce((sum, token) => sum + token.amount, 0)}</p>{isHere && <button disabled={investigator.actionPoints < 1 || declared || isAiControlled} onClick={() => send('investigate')}>調查此地點</button>}{canMove && <button disabled={declared || isAiControlled} onClick={() => send('move', { targetLocationId: location.locationDefinitionId })}>移動到此</button>}</article>})}</section>
    <section className="mps-actions"><div><strong>你的狀態</strong><span>資源 {investigator.resources} · 手牌 {investigator.hand.length} · 牌庫 {investigator.deck.length} · 棄牌 {investigator.discardPile.length}</span></div><button disabled={investigator.actionPoints < 1 || declared || isAiControlled} onClick={() => send('gain_resource')}>拿資源</button><button disabled={investigator.actionPoints < 1 || declared || isAiControlled} onClick={() => send('draw_card')}>抽卡</button><button className="mps-end" disabled={declared || isAiControlled} onClick={declareEnd}>{isAiControlled ? 'AI 正在代打' : declared ? '已宣告結束' : '結束行動'}</button></section>
    <aside className="mps-log"><h2>戰役紀錄</h2>{log.length === 0 ? <p>等待第一個權威事件。</p> : log.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</aside>
    {notice && <p className="mps-notice" role="status">{notice}</p>}
  </main>;
}
