import { useEffect, useMemo, useState } from 'react';
import { clearCardLabReview, fetchCardLabCatalogue, saveCardLabReview } from '../api';
import type { CardLabCard, CardLabReviewStatus } from '../api';
import { filterCardLabCards, formatCardLabIssues } from '../game/cardLabQuality';
import type { CardLabQualityFilter } from '../game/cardLabQuality';
import './CardLabWorkbench.css';

const STATUS_LABEL: Record<CardLabReviewStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  block: 'BLOCK',
};

function cardDescription(card: CardLabCard): string {
  return String(card.description_zh ?? card.ability_text_zh ?? card.play_effect ?? '').trim();
}

export function CardLabWorkbench({
  initialCards,
  handIds,
  onAddCard,
  onClose,
}: {
  initialCards: CardLabCard[];
  handIds: string[];
  onAddCard: (cardId: string) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState(initialCards);
  const [selectedId, setSelectedId] = useState(initialCards[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [faction, setFaction] = useState('all');
  const [cardType, setCardType] = useState('all');
  const [quality, setQuality] = useState<CardLabQualityFilter>('all');
  const [draftStatus, setDraftStatus] = useState<CardLabReviewStatus>('pass');
  const [draftNotes, setDraftNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selected = cards.find((card) => card.id === selectedId) ?? cards[0] ?? null;
  const factions = useMemo(() => [...new Set(cards.map((card) => card.faction).filter(Boolean))].sort(), [cards]);
  const cardTypes = useMemo(() => [...new Set(cards.map((card) => card.card_type).filter(Boolean))].sort(), [cards]);
  const filtered = useMemo(
    () => filterCardLabCards(cards, { search, faction, cardType, quality }),
    [cards, search, faction, cardType, quality],
  );

  const reviewedCount = cards.filter((card) => card.review_status != null).length;

  useEffect(() => {
    let cancelled = false;
    fetchCardLabCatalogue()
      .then((catalogue) => {
        if (cancelled) return;
        setCards(catalogue.cards);
        const refreshed = catalogue.cards.find((card) => card.id === selectedId) ?? catalogue.cards[0] ?? null;
        setSelectedId(refreshed?.id ?? '');
        setDraftStatus(refreshed?.review_status ?? 'pass');
        setDraftNotes(refreshed?.review_notes ?? '');
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDraftStatus(selected.review_status ?? 'pass');
    setDraftNotes(selected.review_notes ?? '');
    setMessage('');
  }, [selected?.id]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((card) => card.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const saveReview = async () => {
    if (!selected || saving) return;
    if ((draftStatus === 'warn' || draftStatus === 'block') && !draftNotes.trim()) {
      setMessage('WARN 與 BLOCK 必須填寫問題紀錄。');
      return;
    }
    setSaving(true);
    setMessage('儲存中…');
    try {
      const review = await saveCardLabReview(selected.id, { status: draftStatus, notes: draftNotes });
      setCards((current) => current.map((card) => card.id === selected.id
        ? {
            ...card,
            review_status: review.status,
            review_notes: review.notes,
            reviewed_at: review.reviewed_at,
            reviewed_by_username: review.reviewed_by_username,
          }
        : card));
      setMessage('評價已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const clearReview = async () => {
    if (!selected?.review_status || saving) return;
    setSaving(true);
    setMessage('清除中…');
    try {
      await clearCardLabReview(selected.id);
      setCards((current) => current.map((card) => card.id === selected.id
        ? { ...card, review_status: null, review_notes: null, reviewed_at: null, reviewed_by_username: null }
        : card));
      setDraftStatus('pass');
      setDraftNotes('');
      setMessage('已恢復為尚未評價。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const copyIssueReport = async () => {
    const report = formatCardLabIssues(cards);
    if (!report) {
      setMessage('目前沒有 WARN 或 BLOCK 紀錄。');
      return;
    }
    const fallbackCopy = () => {
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    };
    let copied = fallbackCopy();
    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(report);
        copied = true;
      } catch {
        copied = false;
      }
    }
    setMessage(copied ? 'WARN/BLOCK 紀錄已複製。' : '無法複製，請逐張開啟紀錄。');
  };

  return (
    <div className="card-lab-workbench-backdrop" role="presentation">
      <section className="card-lab-workbench" role="dialog" aria-modal="true" aria-label="卡片良率檢驗所">
        <header className="clw-header">
          <div>
            <h2>卡片良率檢驗所</h2>
            <p>已評價 {reviewedCount} / {cards.length} 張</p>
          </div>
          <div className="clw-header-actions">
            <button onClick={() => void copyIssueReport()}>複製問題紀錄</button>
            <button className="clw-close" aria-label="關閉卡片目錄" onClick={onClose}>×</button>
          </div>
        </header>

        <div className="clw-toolbar">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋卡名、編號或敘述" aria-label="搜尋卡片" />
          <select value={faction} onChange={(event) => setFaction(event.target.value)} aria-label="篩選陣營">
            <option value="all">全部陣營</option>
            {factions.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
          <select value={cardType} onChange={(event) => setCardType(event.target.value)} aria-label="篩選卡片類型">
            <option value="all">全部類型</option>
            {cardTypes.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
          <select value={quality} onChange={(event) => setQuality(event.target.value as CardLabQualityFilter)} aria-label="篩選評價">
            <option value="all">全部評價</option>
            <option value="unreviewed">尚未評價</option>
            <option value="pass">PASS</option>
            <option value="warn">WARN</option>
            <option value="block">BLOCK</option>
          </select>
        </div>

        <div className="clw-body">
          <div className="clw-list" role="listbox" aria-label="資料庫卡片">
            <div className="clw-result-count">顯示 {filtered.length} 張</div>
            {filtered.map((card) => (
              <button
                type="button"
                role="option"
                aria-selected={card.id === selected?.id}
                className={'clw-card-row' + (card.id === selected?.id ? ' selected' : '')}
                key={card.id}
                onClick={() => setSelectedId(card.id)}
              >
                <span className={`clw-quality ${card.review_status ?? 'unreviewed'}`}>{card.review_status ? STATUS_LABEL[card.review_status] : '未評'}</span>
                <span className="clw-card-name"><strong>{card.name_zh || card.code}</strong><small>{card.code}</small></span>
                <span className="clw-card-tags">{card.faction} · {card.card_type}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="clw-empty">沒有符合條件的卡片。</div>}
          </div>

          <div className="clw-detail">
            {selected ? (
              <>
                <div className="clw-card-heading">
                  <div>
                    <span>{selected.code}</span>
                    <h3>{selected.name_zh || selected.code}</h3>
                    <p>{selected.faction} · {selected.card_type} · 費用 {Number(selected.cost ?? 0)}</p>
                  </div>
                  <button
                    className="clw-add-hand"
                    disabled={handIds.includes(selected.id)}
                    onClick={() => onAddCard(selected.id)}
                  >
                    {handIds.includes(selected.id) ? '已在手牌' : '加入我的手牌'}
                  </button>
                </div>

                <section className="clw-card-copy">
                  <h4>卡片敘述</h4>
                  <p>{cardDescription(selected) || '此卡目前沒有卡片敘述。'}</p>
                  <h4>效果條目</h4>
                  {selected.effects.length > 0
                    ? selected.effects.map((effect, index) => (
                        <p key={`${effect.effect_code}-${index}`}>{String(effect.description_zh ?? effect.effect_code ?? '未命名效果')}</p>
                      ))
                    : <p>沒有結構化效果條目。</p>}
                </section>

                <section className="clw-review-editor">
                  <div className="clw-review-head">
                    <h4>測試評價</h4>
                    {selected.reviewed_at && (
                      <span>{selected.reviewed_by_username} · {new Date(selected.reviewed_at).toLocaleString('zh-TW')}</span>
                    )}
                  </div>
                  <div className="clw-status-control" aria-label="評價狀態">
                    {(['pass', 'warn', 'block'] as const).map((status) => (
                      <button className={draftStatus === status ? `active ${status}` : ''} key={status} onClick={() => setDraftStatus(status)}>
                        {STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder={draftStatus === 'pass' ? 'PASS 可選填測試紀錄' : '請記錄實際結果、預期結果與問題位置'}
                    rows={6}
                    maxLength={5000}
                  />
                  <div className="clw-review-actions">
                    <span className="clw-message" role="status">{message}</span>
                    {selected.review_status && <button disabled={saving} onClick={clearReview}>清除評價</button>}
                    <button className="primary" disabled={saving} onClick={() => void saveReview()}>{saving ? '處理中…' : '保存評價'}</button>
                  </div>
                </section>
              </>
            ) : <div className="clw-empty">資料庫目前沒有卡片。</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
