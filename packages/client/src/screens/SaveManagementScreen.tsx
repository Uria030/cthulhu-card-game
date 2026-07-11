import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CampaignProgress } from '@cthulhu/shared';
import {
  clearPlayerToken,
  createPlayerSave,
  fetchPlayerMe,
  fetchPlayInvestigators,
  getPlayerToken,
  loginPlayer,
  logoutPlayer,
  retirePlayerSave,
  type PlayerMe,
  type PlayerSave,
  type PlayInvestigator,
} from '../api';
import { saveStoredCampaignProgressFor } from '../game/campaignProgressStorage';
import { displayNameFor } from '../game/displayName';
import { playablePresetInvestigators } from '../game/investigatorRoster';
import { setSelectedInvestigator } from '../game/selectedInvestigator';
import { clearSelectedSave, getSelectedSave, setSelectedSave } from '../game/selectedSave';
import './SaveManagementScreen.css';

const ATTR_LABELS: Array<[keyof PlayInvestigator, string]> = [
  ['attr_strength', '力量'], ['attr_agility', '敏捷'], ['attr_constitution', '體魄'], ['attr_reflex', '反應'],
  ['attr_intellect', '智識'], ['attr_willpower', '意志'], ['attr_perception', '感知'], ['attr_charisma', '魅力'],
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

function progressCampaignId(save: PlayerSave): string | null {
  const progress = save.campaign_progress as { campaignId?: unknown } | null;
  return save.campaign_id ?? (typeof progress?.campaignId === 'string' ? progress.campaignId : null);
}

export function SaveManagementScreen() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [playerMe, setPlayerMe] = useState<PlayerMe | null>(null);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<PlayInvestigator[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!getPlayerToken()) {
      setAuthChecked(true);
      return;
    }
    fetchPlayerMe()
      .then((me) => { if (!cancelled) setPlayerMe(me); })
      .catch(() => { if (!cancelled) clearPlayerToken(); })
      .finally(() => { if (!cancelled) setAuthChecked(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!playerMe || candidates !== null) return;
    fetchPlayInvestigators({ includeDraft: true })
      .then((rows) => setCandidates(playablePresetInvestigators(rows)))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [candidates, playerMe]);

  const groups = useMemo(() => {
    const byFaction = new Map<string, PlayInvestigator[]>();
    for (const candidate of candidates ?? []) {
      const faction = candidate.faction_code || '?';
      byFaction.set(faction, [...(byFaction.get(faction) ?? []), candidate]);
    }
    return [...byFaction.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [candidates]);

  const selectSave = (save: PlayerSave) => {
    if (!candidates?.some((candidate) => candidate.id === save.template_id)) {
      setError('這是舊測試調查員存檔，不屬於正式 64 人名冊，請將它退休後建立新存檔。');
      return;
    }
    const selected = selectedFromSave(save);
    setSelectedInvestigator(selected);
    setSelectedSave({ id: save.id, slot: save.slot, template_id: save.template_id, campaign_id: save.campaign_id });
    const campaignId = progressCampaignId(save);
    if (campaignId && Object.keys(save.campaign_progress ?? {}).length > 0) {
      saveStoredCampaignProgressFor(campaignId, save.template_id, save.campaign_progress as CampaignProgress);
    }
    navigate('/lobby');
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('login');
    setError(null);
    try {
      setPlayerMe(await loginPlayer(loginName, loginPassword));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const createSave = async (candidate: PlayInvestigator) => {
    if (!playerMe || pendingSlot == null) return;
    setBusy(`create:${pendingSlot}`);
    setError(null);
    try {
      const save = await createPlayerSave({ slot: pendingSlot, template_id: candidate.id, campaign_progress: {} });
      setPlayerMe({ ...playerMe, saves: [save, ...playerMe.saves] });
      setPendingSlot(null);
      selectSave(save);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const retireSave = async (save: PlayerSave) => {
    if (!window.confirm(`確定讓「${displayNameFor(selectedFromSave(save))}」退休？`)) return;
    setBusy(`retire:${save.id}`);
    try {
      const me = await retirePlayerSave(save.id);
      setPlayerMe(me);
      if (getSelectedSave()?.id === save.id) clearSelectedSave();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    await logoutPlayer();
    clearSelectedSave();
    setPlayerMe(null);
  };

  if (!authChecked) return <main className="save-root"><div className="save-loading">讀取帳號...</div></main>;

  if (!playerMe) {
    return (
      <main className="save-root">
        <form className="save-login" onSubmit={submitLogin}>
          <h1>調查員帳號</h1>
          <label><span>帳號或 Email</span><input value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="username" /></label>
          <label><span>密碼</span><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" /></label>
          {error && <div className="save-error">{error}</div>}
          <button type="submit" disabled={busy === 'login' || !loginName || !loginPassword}>{busy === 'login' ? '登入中...' : '登入'}</button>
        </form>
      </main>
    );
  }

  const activeBySlot = new Map(playerMe.saves.filter((save) => save.status === 'active').map((save) => [save.slot, save]));
  const slots = Array.from({ length: playerMe.player.save_slots_max }, (_, index) => index + 1);

  return (
    <main className="save-root">
      <header className="save-header">
        <div><span>帳號</span><strong>{playerMe.player.username}</strong></div>
        <h1>調查員存檔</h1>
        <button onClick={doLogout}>登出</button>
      </header>
      <section className="save-list" aria-label="調查員存檔列表">
        {slots.map((slot) => {
          const save = activeBySlot.get(slot);
          if (!save) {
            return <button key={slot} className="save-row empty" onClick={() => { setPendingSlot(slot); setError(null); }}><span>存檔 {slot}</span><strong>建立調查員</strong></button>;
          }
          const supported = candidates?.some((candidate) => candidate.id === save.template_id) ?? false;
          return (
            <div className="save-row" key={slot}>
              <button className="save-select" disabled={!supported} onClick={() => selectSave(save)}>
                <span>存檔 {slot}</span><strong>{displayNameFor(selectedFromSave(save))}</strong>
                <small>{supported ? (save.title_zh || '調查員') : (candidates ? '舊測試存檔，不可使用' : '確認名冊中...')}</small>
              </button>
              <button className="save-retire" disabled={busy === `retire:${save.id}`} onClick={() => retireSave(save)}>退休</button>
            </div>
          );
        })}
      </section>
      <footer className="save-summary">已故 {playerMe.player.dead_count} 位 · 退休 {playerMe.player.retired_count} 位</footer>

      {pendingSlot != null && (
        <div className="save-picker-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setPendingSlot(null); }}>
          <section className="save-picker">
            <button className="save-picker-close" aria-label="關閉" onClick={() => setPendingSlot(null)}>×</button>
            <h2>為存檔 {pendingSlot} 選擇調查員</h2>
            <p>名冊只顯示正式 64 位預設調查員。</p>
            {error && <div className="save-error">{error}</div>}
            {!candidates && !error && <div className="save-loading">載入名冊...</div>}
            <div className="save-picker-groups">
              {groups.map(([faction, rows]) => (
                <section key={faction}>
                  <h3>{faction} 陣營</h3>
                  <div className="save-picker-grid">
                    {rows.map((candidate) => (
                      <button key={candidate.id} disabled={busy === `create:${pendingSlot}`} onClick={() => createSave(candidate)}>
                        <strong>{displayNameFor(candidate)}</strong>
                        <span>{candidate.title_zh || '調查員'}</span>
                        <small>{ATTR_LABELS.map(([key, label]) => `${label}${Number(candidate[key] ?? 0)}`).join(' · ')}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
