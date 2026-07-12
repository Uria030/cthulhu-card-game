import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MultiplayerRoomSnapshot, MultiplayerServerMessage } from '@cthulhu/shared';
import {
  createMultiplayerRoom,
  fetchMultiplayerRoom,
  fetchPlayerMe,
  fetchPlayInvestigators,
  fetchPlayStages,
  getPlayerToken,
  joinMultiplayerRoom,
  selectMultiplayerInvestigator,
  setMultiplayerReady,
  startMultiplayerRoom,
} from '../api';
import type { PlayInvestigator, PlayStageListItem, PlayerAccount } from '../api';
import { openMultiplayerTransport, type MultiplayerTransport } from '../game/multiplayerTransport';
import { playablePresetInvestigators } from '../game/investigatorRoster';
import { getSelectedSave } from '../game/selectedSave';
import './MultiplayerRoomScreen.css';

function roomCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '').slice(0, 6);
}

function seatLabel(snapshot: MultiplayerRoomSnapshot, playerId: string, candidates: PlayInvestigator[]): string {
  const seat = snapshot.members.find((member) => member.playerId === playerId);
  if (!seat?.investigatorTemplateId) return '尚未選人';
  const investigator = candidates.find((candidate) => candidate.id === seat.investigatorTemplateId);
  return investigator?.title_zh || investigator?.name_zh || '未知調查員';
}

export function MultiplayerRoomScreen() {
  const navigate = useNavigate();
  const { roomCode: roomCodeParam } = useParams();
  const roomCode = roomCodeParam?.toUpperCase() ?? null;
  const [account, setAccount] = useState<PlayerAccount | null>(null);
  const [snapshot, setSnapshot] = useState<MultiplayerRoomSnapshot | null>(null);
  const [candidates, setCandidates] = useState<PlayInvestigator[]>([]);
  const [stages, setStages] = useState<PlayStageListItem[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [stageId, setStageId] = useState('');
  const [notice, setNotice] = useState('');
  const transportRef = useRef<MultiplayerTransport | null>(null);

  useEffect(() => {
    if (!getPlayerToken()) {
      navigate('/saves', { replace: true });
      return;
    }
    let cancelled = false;
    Promise.all([fetchPlayerMe(), fetchPlayInvestigators({ includeDraft: true }), fetchPlayStages()])
      .then(([me, investigators, playableStages]) => {
        if (cancelled) return;
        setAccount(me.player);
        setCandidates(playablePresetInvestigators(investigators));
        const mainStages = playableStages.filter((stage) => stage.stage_type === 'main' && !stage.is_hidden);
        setStages(mainStages);
        setStageId((current) => current || mainStages[0]?.id || '');
      })
      .catch((error: unknown) => !cancelled && setNotice(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    if (!roomCode || !getPlayerToken()) return;
    let cancelled = false;
    fetchMultiplayerRoom(roomCode)
      .then((next) => { if (!cancelled) setSnapshot(next); })
      .catch((error: unknown) => !cancelled && setNotice(error instanceof Error ? error.message : String(error)));
    const onMessage = (message: MultiplayerServerMessage) => {
      if (message.type === 'room_snapshot' || message.type === 'intent_resolved' || message.type === 'ai_turn_completed' || message.type === 'phase_changed') {
        setSnapshot(message.snapshot);
      } else if (message.type === 'room_closed') {
        setNotice('房主已關閉房間。');
        navigate('/multiplayer', { replace: true });
      } else if (message.type === 'error') {
        setNotice(message.message);
        if (message.snapshot) setSnapshot(message.snapshot);
      }
    };
    transportRef.current = openMultiplayerTransport({ roomCode, token: getPlayerToken()!, onMessage, onClose: () => setNotice('連線中斷；重連後會交還操作權。') });
    return () => {
      cancelled = true;
      transportRef.current?.close();
      transportRef.current = null;
    };
  }, [navigate, roomCode]);

  useEffect(() => {
    if (snapshot?.phase === 'active' && roomCode) navigate(`/multiplayer/${roomCode}/scenario`, { replace: true });
  }, [navigate, roomCode, snapshot?.phase]);

  const taken = useMemo(() => new Set(snapshot?.members.map((member) => member.investigatorTemplateId).filter(Boolean)), [snapshot]);
  const isHost = !!account && snapshot?.hostPlayerId === account.id;
  const selfSeat = snapshot?.members.find((member) => member.playerId === account?.id) ?? null;

  const createRoom = async () => {
    try {
      const room = await createMultiplayerRoom();
      navigate(`/multiplayer/${room.roomCode}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const joinRoom = async () => {
    const code = roomCodeInput(inviteCode);
    if (code.length !== 6) { setNotice('請輸入六碼房間碼。'); return; }
    try {
      await joinMultiplayerRoom(code);
      navigate(`/multiplayer/${code}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const select = async (templateId: string) => {
    if (!roomCode) return;
    const selectedSave = getSelectedSave();
    if (!selectedSave || selectedSave.template_id !== templateId) {
      setNotice('多人結算會寫回目前選定的調查員存檔；請先在存檔管理選擇這位調查員。');
      return;
    }
    try { setSnapshot(await selectMultiplayerInvestigator(roomCode, templateId, selectedSave.id)); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const ready = async () => {
    if (!roomCode || !selfSeat) return;
    try { setSnapshot(await setMultiplayerReady(roomCode, !selfSeat.ready)); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  const start = async () => {
    if (!roomCode || !stageId) return;
    try { setSnapshot(await startMultiplayerRoom(roomCode, stageId)); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  if (!roomCode) {
    return <main className="mp-root"><section className="mp-entry" aria-labelledby="mp-title">
      <p className="mp-kicker">多人調查</p><h1 id="mp-title">邀請電報</h1>
      <button className="mp-primary" onClick={createRoom}>建立房間</button>
      <label className="mp-join-label">房間碼
        <input value={inviteCode} onChange={(event) => setInviteCode(roomCodeInput(event.target.value))} placeholder="六碼房間碼" inputMode="text" autoCapitalize="characters" />
      </label>
      <button className="mp-secondary" onClick={joinRoom}>加入房間</button>
      <button className="mp-back" onClick={() => navigate('/lobby')}>返回調查室</button>
      {notice && <p className="mp-notice" role="status">{notice}</p>}
    </section></main>;
  }

  return <main className="mp-root"><header className="mp-header"><button className="mp-back" onClick={() => navigate('/lobby')}>返回調查室</button><div><p className="mp-kicker">多人調查房</p><h1>房間碼 {roomCode}</h1></div></header>
    <section className="mp-room-status" aria-label="房間席位">
      {(snapshot?.members ?? []).map((member) => <div key={member.playerId} className="mp-seat">
        <strong>{member.username}{member.playerId === snapshot?.hostPlayerId ? ' · 房主' : ''}</strong>
        <span>{seatLabel(snapshot!, member.playerId, candidates)}</span>
        <small>{member.ready ? '已 ready' : member.connected ? '選擇中' : '暫時斷線'}</small>
      </div>)}
      {Array.from({ length: Math.max(0, 4 - (snapshot?.members.length ?? 0)) }).map((_, index) => <div className="mp-seat mp-ai-seat" key={`ai-${index}`}><strong>AI 補位</strong><span>開始時自動組隊</span><small>待命</small></div>)}
    </section>
    <section className="mp-selection" aria-label="選擇調查員"><div className="mp-section-heading"><h2>64 選 1</h2><span>{selfSeat?.ready ? '你已 ready' : '選擇後按 ready'}</span></div>
      <div className="mp-investigator-grid">{candidates.map((candidate) => {
        const chosenByOther = taken.has(candidate.id) && selfSeat?.investigatorTemplateId !== candidate.id;
        const chosen = selfSeat?.investigatorTemplateId === candidate.id;
        return <button key={candidate.id} className={chosen ? 'is-selected' : ''} disabled={chosenByOther || !!selfSeat?.ready} onClick={() => select(candidate.id)}>
          <strong>{candidate.title_zh || candidate.name_zh}</strong><small>{candidate.faction_code} · {candidate.mbti_code}</small>{chosenByOther && <em>已選</em>}
        </button>;
      })}</div>
    </section>
    <footer className="mp-actions">
      <button className="mp-primary" disabled={!selfSeat?.investigatorTemplateId} onClick={ready}>{selfSeat?.ready ? '取消 ready' : '我已準備'}</button>
      {isHost && <label>關卡<select value={stageId} onChange={(event) => setStageId(event.target.value)}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name_zh}</option>)}</select></label>}
      {isHost && <button className="mp-primary" onClick={start}>全員 ready 後開始</button>}
      {notice && <p className="mp-notice" role="status">{notice}</p>}
    </footer>
  </main>;
}
