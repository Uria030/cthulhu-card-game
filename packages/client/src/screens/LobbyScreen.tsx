import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoComposeParty } from '@cthulhu/shared';
import { fetchPlayerMe, fetchPlayInvestigators, getPlayerToken } from '../api';
import type { PlayInvestigator, PlayerSave } from '../api';
import { getSelectedInvestigator, setSelectedInvestigator } from '../game/selectedInvestigator';
import { getSelectedSave } from '../game/selectedSave';
import { setPartyTemplateIds } from '../game/selectedParty';
import { displayNameFor } from '../game/displayName';
import { playablePresetInvestigators } from '../game/investigatorRoster';
import { pawnAssetForInvestigator, playerToneForSlot } from '../game/investigatorVisuals';
import { InteractiveLobbyProp, LobbyFilmGrain } from './LobbyEffects';
import type { LobbyPropPosition } from './LobbyEffects';
import './LobbyScreen.css';

interface LobbyPropDefinition {
  id: string;
  label: string;
  detail: string;
  available: boolean;
  position: LobbyPropPosition;
}

const LOBBY_PROPS: LobbyPropDefinition[] = [
  { id: 'ledger', label: '調查帳本', detail: '調整下一關牌組', available: false, position: { left: '14%', top: '76%', size: '13%' } },
  { id: 'scale', label: '銀色天平', detail: '購買與強化', available: false, position: { left: '23%', top: '59%', size: '12%' } },
  { id: 'censer', label: '黃銅香爐', detail: '團隊精神', available: false, position: { left: '48%', top: '66%', size: '12%' } },
  { id: 'forge', label: '鐵砧與鎚', detail: '鍛造裝備', available: false, position: { left: '57%', top: '67%', size: '11%' } },
  { id: 'flask', label: '玻璃藥瓶', detail: '製作道具', available: false, position: { left: '66%', top: '59%', size: '12%' } },
  { id: 'tomes', label: '研究厚書', detail: '研究與升級', available: false, position: { left: '84%', top: '76%', size: '13%' } },
  { id: 'parch', label: '封蠟文件', detail: '花費天賦點', available: false, position: { left: '51%', top: '81%', size: '12%' } },
  { id: 'map', label: '地圖紙', detail: '選擇下一個關卡', available: true, position: { left: '76%', top: '78%', size: '16%' } },
];

const SEAT_POSITIONS = [
  { left: '10%', top: '58%' },
  { left: '36%', top: '49%' },
  { left: '59%', top: '49%' },
  { left: '86%', top: '58%' },
];

function selectedFromSave(save: PlayerSave) {
  return {
    id: save.template_id,
    name_zh: save.name_zh,
    title_zh: save.title_zh,
    mbti_code: save.mbti_code,
    faction_code: save.faction_code,
    is_completed: save.is_completed,
  };
}

export function LobbyScreen() {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<PlayInvestigator[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [selected, setSelected] = useState(getSelectedInvestigator());
  const [partySeed, setPartySeed] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [cardLabCreator, setCardLabCreator] = useState(false);
  const [propMessage, setPropMessage] = useState('地圖紙已攤在桌角，隊伍隨時可以出發。');

  useEffect(() => {
    if (!authChecked || !selected || candidates !== null) return;
    fetchPlayInvestigators({ includeDraft: true })
      .then((rows) => setCandidates(playablePresetInvestigators(rows)))
      .catch((reason: unknown) => setPickerError(reason instanceof Error ? reason.message : String(reason)));
  }, [authChecked, candidates, selected]);

  useEffect(() => {
    let cancelled = false;
    if (!getPlayerToken()) {
      navigate('/saves', { replace: true });
      return;
    }
    fetchPlayerMe()
      .then((me) => {
        if (cancelled) return;
        const selectedSaveId = getSelectedSave()?.id;
        const username = me.player.username.trim().toLowerCase();
        setCardLabCreator(username === 'creator01' || username === 'creator02');
        const active = me.saves.find((save) => save.status === 'active' && save.id === selectedSaveId) ?? null;
        if (!active) {
          navigate('/saves', { replace: true });
          return;
        }
        const nextSelected = selectedFromSave(active);
        setSelectedInvestigator(nextSelected);
        setSelected(nextSelected);
      })
      .catch(() => { if (!cancelled) navigate('/saves', { replace: true }); })
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, [navigate]);

  const selectedCandidate = useMemo(
    () => candidates?.find((investigator) => investigator.id === selected?.id) ?? null,
    [candidates, selected?.id],
  );
  const autoParty = useMemo(
    () => selectedCandidate && candidates ? autoComposeParty(selectedCandidate, candidates, partySeed) : null,
    [selectedCandidate, candidates, partySeed],
  );
  const partyMembers = autoParty?.members ?? [];
  const lobbyProps = useMemo(() => LOBBY_PROPS.map((prop) => (
    prop.id === 'flask' && cardLabCreator
      ? { ...prop, id: 'card-lab', label: '卡片檢驗所', detail: '檢驗資料庫卡片', available: true }
      : prop
  )), [cardLabCreator]);

  useEffect(() => {
    if (partyMembers.length === 3) setPartyTemplateIds(partyMembers.map((investigator) => investigator.id));
  }, [partyMembers]);

  const activateProp = (prop: LobbyPropDefinition) => {
    if (prop.id === 'map') {
      navigate('/departure');
      return;
    }
    if (prop.id === 'card-lab') {
      navigate('/scenario/card-lab');
      return;
    }
    setPropMessage(`${prop.label}尚未開放；它會在整備系統完成後成為「${prop.detail}」入口。`);
  };

  if (!authChecked) {
    return <main className="lobby-root"><div className="lobby-auth-panel"><div className="lobby-auth-title">讀取調查員檔案</div></div></main>;
  }

  return (
    <main className="lobby-root">
      <img className="lobby-scene" src="/game-art/lobby-v3/investigator-study-empty.png" alt="1930 年代空曠的調查室，桌上擺著可供整備的物件" />
      <LobbyFilmGrain />

      <header className="lobby-header">
        <h1 className="lobby-title">調查室</h1>
        <p className="lobby-sub">四人調查隊伍</p>
      </header>

      <section className="lobby-props" aria-label="大廳功能入口">
        {lobbyProps.map((prop) => (
          <InteractiveLobbyProp
            key={prop.id}
            label={prop.label}
            detail={prop.detail}
            position={prop.position}
            available={prop.available}
            onActivate={() => activateProp(prop)}
          />
        ))}
      </section>

      <section className="lobby-seats" aria-label="調查隊伍座位">
        {Array.from({ length: 4 }, (_, slot) => {
          const member = slot === 0
            ? { id: selected?.id ?? '', title_zh: selected?.title_zh, label: '玩家' }
            : partyMembers[slot - 1]
              ? { id: partyMembers[slot - 1].id, title_zh: partyMembers[slot - 1].title_zh, code: partyMembers[slot - 1].code, label: `隊友 ${slot}` }
              : { id: '', label: `隊友 ${slot}` };
          return (
          <div
            className="lobby-seat-token"
            key={`${member.id}-${slot}`}
            style={{
              ...SEAT_POSITIONS[slot],
              '--seat-tone': playerToneForSlot(slot),
            } as CSSProperties}
            aria-label={`${member.label}：${displayNameFor(member, '等待組隊')}`}
          >
            {member.id && <><img src={pawnAssetForInvestigator(member)} alt="" /><span>{member.label}</span></>}
          </div>
          );
        })}
      </section>

      <aside className="lobby-roster" aria-label="調查隊伍">
        <div className="lr-title">調查隊伍</div>
        <div className="lr-slot lr-player-slot"><span className="lr-role">玩家</span><span className="lr-name">{displayNameFor(selected, '尚未選擇存檔')}</span></div>
        {[0, 1, 2].map((index) => (
          <div key={index} className="lr-slot lr-ai">
            <span className="lr-role">隊友 {index + 1}</span>
            <span className="lr-name">{displayNameFor(partyMembers[index], '等待組隊')}</span>
          </div>
        ))}
        <button className="lr-reroll" disabled={!selectedCandidate || (candidates?.length ?? 0) < 4} onClick={() => setPartySeed((value) => value + 1)}>換一組</button>
        <button className="lr-manage-saves" onClick={() => navigate('/saves')}>管理調查員存檔</button>
        {pickerError && <div className="lr-note">名冊載入失敗：{pickerError}</div>}
      </aside>

      <div className="lobby-prop-message" role="status" aria-live="polite">{propMessage}</div>
      <footer className="lobby-footer">
        <button className="lobby-back" onClick={() => navigate('/saves')}>返回存檔</button>
        <span>點選桌上物件進行整備或出發。</span>
      </footer>
    </main>
  );
}
