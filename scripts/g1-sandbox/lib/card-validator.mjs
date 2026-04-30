// 後驗閘:對 Gemini 回傳的卡片 JSON 跑同一套 s06 規範檢查
// 規則表來源:packages/client/public/admin/admin-shared.js 的 CARD_TEXT_FORBIDDEN_TERMS / LEGAL_CARD_KEYWORDS / LEGAL_CARD_STATUSES
// 短期雙寫,preflight 第 12 條會強制檢查雙邊一致性,避免漂移

// ─── s06 禁用詞清單（與 admin-shared.js 必須一致）─────────────────
export const CARD_TEXT_FORBIDDEN_TERMS = {
  '該玩家': '你',
  '我方': '你的',
  '我的': '你的',
  '否則': '請改用「如果失敗,...」獨立句',
  '反之': '請改用另起獨立「如果 X,...」句',
  '及': '和',
  '跟': '和',
  '打他': '造成',
  '扣血': '造成 N 點傷害',
  '扣掉': '造成',
  '補血': '治癒 N 點傷害',
  '補理智': '治癒 N 點恐懼',
  '療傷': '治癒 N 點傷害',
  '橫置': '消耗',
  '冷卻': '消耗',
  '七屬性': '八屬性',
  '七大屬性': '八大屬性',
  '反射神經': '反應',
  '無視該次': '（Cancel 用「取消」/Ignore 用「忽略」/Prevent 用「預防」,視語意選擇）',
};

// ─── s06 §5.1 量化 SAN/HP 對齊規則(輕量級檢查,給 mythos/encounter 用)──
// 偵測「N SAN」「N HP」「N 理智」等口語化寫法,規範要求「N 點恐懼」「N 點傷害」
const SAN_HP_PATTERNS = [
  { re: /(\d+)\s*SAN(?!\s*上限)/g, fix: '$1 點恐懼', name: 'SAN 應為「點恐懼」' },
  { re: /(\d+)\s*HP(?!\s*上限)/g, fix: '$1 點傷害', name: 'HP 應為「點傷害」' },
  { re: /(\d+)\s*點\s*SAN/g, fix: '$1 點恐懼', name: '「點 SAN」應為「點恐懼」' },
  { re: /(\d+)\s*點\s*HP/g, fix: '$1 點傷害', name: '「點 HP」應為「點傷害」' },
  { re: /承受\s*(\d+)\s*SAN/g, fix: '承受 $1 點恐懼', name: '「承受 N SAN」應為「承受 N 點恐懼」' },
  { re: /失敗\s*(\d+)\s*SAN/g, fix: '失敗承受 $1 點恐懼', name: '「失敗 N SAN」應為「失敗承受 N 點恐懼」' },
  { re: /扣\s*(\d+)\s*SAN/g, fix: '造成 $1 點恐懼', name: '「扣 N SAN」應為「造成 N 點恐懼」' },
  { re: /扣\s*(\d+)\s*HP/g, fix: '造成 $1 點傷害', name: '「扣 N HP」應為「造成 N 點傷害」' },
];

export function scanSanHpViolations(text) {
  if (!text || typeof text !== 'string') return [];
  const warnings = [];
  for (const { re, fix, name } of SAN_HP_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      warnings.push({
        match: m[0],
        suggestion: text.slice(0).replace(re.source ? re : null, fix).slice(Math.max(0, m.index), m.index + 16),
        rule: name,
        index: m.index,
      });
    }
  }
  return warnings;
}

// 自動修正 SAN/HP(高信心,直接套用)
export function autoFixSanHp(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { re, fix } of SAN_HP_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), fix);
  }
  return out;
}

// ─── 合法關鍵字 / 狀態 / effect 動詞清單 ──────────────────────────
export const LEGAL_CARD_KEYWORDS = new Set(['fast_play', '快速', 'target_other']);

export const LEGAL_CARD_STATUSES = new Set([
  'poison','bleed','burning','frozen','doom_status','madness','marked','vulnerable','weakness_status','wet','weakened',
  'darkness','disarm','fatigue','silence',
  'empowered','armor','ward','haste','regeneration',
  'stealth',
  '中毒','流血','燃燒','冷凍','毀滅','發瘋','標記','脆弱','弱點','潮濕','虛弱',
  '黑暗','繳械','疲勞','沉默',
  '強化','護甲','護盾','加速','再生',
  '隱蔽',
]);

export const LEGAL_EFFECT_VERBS_AS_NOUN = new Set([
  'counterattack','反擊','taunt','嘲諷','extra_attack','額外攻擊','evade','閃避',
]);

// ─── 合法 effect_code（與 geminiDirectClient.js DIRECT_GEMINI_VALID_EFFECT_CODES 一致）──
export const VALID_EFFECT_CODES = new Set([
  'deal_damage','deal_horror','heal_hp','heal_san','restore_hp_max','restore_san_max','transfer_damage','transfer_horror',
  'draw_card','reveal_top','search_deck','retrieve_card','return_to_deck','discard_card','shuffle_deck','remove_from_game',
  'gain_resource','spend_resource','steal_resource','transfer_resource',
  'move_investigator','move_enemy','swap_position','place_enemy','jump',
  'engage_enemy','disengage_enemy','exhaust_card','ready_card','stun_enemy','add_status','remove_status',
  'make_test','modify_test','wild_attr_boost','reroll','auto_success','auto_fail',
  'attack','evade','taunt','counterattack','extra_attack',
  'place_clue','discover_clue','place_doom','remove_doom','seal_gate','spawn_enemy','remove_enemy','execute_enemy',
  'reveal_tile','place_tile','remove_tile','place_haunting','remove_haunting','advance_act','advance_agenda','connect_tiles','disconnect_tiles',
  'create_light','extinguish_light','create_darkness','remove_darkness','create_fire','extinguish_fire',
  'add_keyword','remove_keyword','add_bless','add_curse','remove_bless','remove_curse','look_chaos_bag','manipulate_chaos_bag',
  'teleport','stabilize_ally','revive_ally','fast_play','target_other','direct_deploy','gain_use','transform',
  'attach_to_self','noop','reload_weapon','choose_one',
]);

// ─── 低風險自動修正（s06 Part 3 §7.1）──────────────────────────────
export function normalizeCardText(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  // 半形減號 → 全形減號
  out = out.replace(/([\s:：,，(（+\-])-(\d)/g, (_m, pre, d) => pre + '−' + d);
  out = out.replace(/^-(\d)/g, '−$1');
  // 中文數字量詞 → 阿拉伯
  const CJK_NUM = { '零':'0','一':'1','兩':'2','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10' };
  out = out.replace(/([零一兩二三四五六七八九十])(點|張|次|個|名|位)/g, (_m, n, u) => (CJK_NUM[n] || n) + ' ' + u);
  // 全形阿拉伯 → 半形
  out = out.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  return out;
}

// ─── 掃禁用詞（s06 Part 1 §3-5）─────────────────────────────────
export function scanForbiddenTerms(text) {
  if (!text || typeof text !== 'string') return [];
  const warnings = [];
  for (const [bad, good] of Object.entries(CARD_TEXT_FORBIDDEN_TERMS)) {
    let idx = text.indexOf(bad);
    while (idx !== -1) {
      warnings.push({ term: bad, suggestion: good, index: idx });
      idx = text.indexOf(bad, idx + bad.length);
    }
  }
  return warnings;
}

// ─── 掃 hallucination（AI 發明的關鍵字 / 狀態）─────────────────────
export function scanCardDescForHallucinations(card) {
  if (!card || typeof card !== 'object') return [];
  const warnings = [];
  const fields = [];
  if (Array.isArray(card.effects)) {
    card.effects.forEach((e, i) => {
      if (e && typeof e.desc_zh === 'string') fields.push({ field: 'effects[' + i + '].desc_zh', text: e.desc_zh });
    });
  }
  if (typeof card.flavor_text === 'string') fields.push({ field: 'flavor_text', text: card.flavor_text });

  const patterns = [
    /(?:獲得|賦予|施加|具備|擁有|得到|加上|附加|掛上)(?:[^『「]{0,6})[『「]([^』」]{1,16})[』」]\s*(?:關鍵字|狀態|標記|屬性|能力)/g,
    /[『「]([^』」]{1,16})[』」]\s*(?:關鍵字|狀態|標記)/g,
  ];

  const seen = new Set();
  for (const { field, text } of fields) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const term = (m[1] || '').trim();
        if (!term) continue;
        if (LEGAL_CARD_KEYWORDS.has(term) || LEGAL_CARD_STATUSES.has(term)) continue;
        const key = field + '::' + term;
        if (seen.has(key)) continue;
        seen.add(key);
        const isVerbMisuse = LEGAL_EFFECT_VERBS_AS_NOUN.has(term);
        warnings.push({
          field,
          type: isVerbMisuse ? 'effect_verb_as_keyword' : 'unknown_term',
          term,
          context: text.slice(Math.max(0, m.index - 4), Math.min(text.length, m.index + m[0].length + 4)),
          hint: isVerbMisuse
            ? ('「' + term + '」是 effect_code 動詞,不是關鍵字——應寫成獨立 effect')
            : ('「' + term + '」不在合法清單,疑似 AI 發明術語'),
        });
      }
    }
  }
  return warnings;
}

// ─── s06 結構性檢查（【行動】/【被動】/【反應】/【強制】框架是否使用）──
const ACTION_FRAME_RE = /【(行動|免費行動|反應|被動|強制|加值|消費)】/;

export function scanS06StructuralIssues(card) {
  if (!card || typeof card !== 'object') return [];
  const warnings = [];
  if (!Array.isArray(card.effects)) return warnings;

  for (let i = 0; i < card.effects.length; i++) {
    const e = card.effects[i];
    if (!e || typeof e.desc_zh !== 'string') continue;
    const desc = e.desc_zh;

    // 1. 主動 trigger（action / reaction / on_play 等）必須有【】框架
    const isActiveTrigger = ['action','free_action','reaction','on_play','on_consume','on_commit'].includes(e.trigger);
    if (isActiveTrigger && !ACTION_FRAME_RE.test(desc)) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_no_action_frame',
        message: `trigger=${e.trigger} 但 desc_zh 沒有【行動】/【免費行動】/【反應】等框架(s06 §2.1)`,
      });
    }

    // 2. 主詞檢查:沒有「你」也沒「此卡」也沒「該敵人」
    const hasSubject = /你|此卡|此資產|此盟友|該敵人|目標敵人|該卡|你的/.test(desc);
    if (!hasSubject && desc.length > 8) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_no_subject',
        message: 'desc_zh 缺主詞「你」/「此卡」/「該敵人」(s06 §6.1)',
      });
    }

    // 3. 「當 X 時」應為「在 X 時」
    if (/當[^,，。]{1,8}時/.test(desc)) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_when_should_be_at',
        message: '「當 X 時」應改為「在 X 時」(s06 v2 觸發句型)',
      });
    }

    // 4. 「若」應為「如果」(條件句開頭)
    if (/^若|[,，。]若/.test(desc)) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_if_should_be_ruguo',
        message: '「若」應改為「如果」(s06 v2 條件句)',
      });
    }

    // 5. 「抽 N 張卡」應為「抽 N 張牌」
    if (/抽\s*\d+\s*張\s*卡(?!片)/.test(desc) || /抽一張卡/.test(desc) || /抽兩張卡/.test(desc)) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_card_should_be_pai',
        message: '「抽 X 張卡」應改為「抽 X 張牌」(s06 §5.2)',
      });
    }

    // 6. 「獲得 N 個資源」應為「獲得 N 資源」
    if (/獲得\s*\d+\s*個\s*資源/.test(desc)) {
      warnings.push({
        field: `effects[${i}].desc_zh`,
        type: 's06_extra_unit',
        message: '「獲得 X 個資源」應改為「獲得 X 資源」(s06 §5.3)',
      });
    }
  }
  return warnings;
}

// ─── effect_code 白名單檢查 ────────────────────────────────────────
export function scanEffectCodeViolations(card) {
  if (!card || !Array.isArray(card.effects)) return [];
  const warnings = [];
  for (let i = 0; i < card.effects.length; i++) {
    const e = card.effects[i];
    if (!e || !e.effect_code) continue;
    if (!VALID_EFFECT_CODES.has(e.effect_code)) {
      warnings.push({
        field: `effects[${i}].effect_code`,
        type: 'invalid_effect_code',
        message: `effect_code「${e.effect_code}」不在合法清單(共 ${VALID_EFFECT_CODES.size} 個)`,
      });
    }
  }
  return warnings;
}

// ─── 主入口:對一張卡跑全部驗閘 ─────────────────────────────────
export function validateCard(card) {
  const errors = [];
  const warnings = [];

  // 結構性 s06 檢查
  for (const w of scanS06StructuralIssues(card)) {
    if (w.type === 's06_no_action_frame' || w.type === 's06_no_subject') errors.push(w);
    else warnings.push(w);
  }

  // hallucination
  for (const w of scanCardDescForHallucinations(card)) {
    warnings.push(w);
  }

  // effect_code 白名單(error)
  for (const w of scanEffectCodeViolations(card)) {
    errors.push(w);
  }

  // 禁用詞掃描(對所有 desc_zh + flavor_text)
  const allText = [];
  if (Array.isArray(card.effects)) {
    for (let i = 0; i < card.effects.length; i++) {
      const e = card.effects[i];
      if (e && typeof e.desc_zh === 'string') allText.push({ field: `effects[${i}].desc_zh`, text: e.desc_zh });
    }
  }
  if (typeof card.flavor_text === 'string') allText.push({ field: 'flavor_text', text: card.flavor_text });

  for (const { field, text } of allText) {
    for (const w of scanForbiddenTerms(text)) {
      warnings.push({
        field,
        type: 'forbidden_term',
        term: w.term,
        suggestion: w.suggestion,
        message: `禁用詞「${w.term}」(建議:${w.suggestion})`,
      });
    }
  }

  return { errors, warnings, passed: errors.length === 0 };
}

// ─── 自動修正 desc_zh / flavor_text 的低風險文字 ─────────────────
export function autoNormalizeCard(card) {
  if (!card) return card;
  if (Array.isArray(card.effects)) {
    for (const e of card.effects) {
      if (e && typeof e.desc_zh === 'string') e.desc_zh = normalizeCardText(e.desc_zh);
      if (e && typeof e.desc_en === 'string') e.desc_en = e.desc_en;
    }
  }
  if (typeof card.flavor_text === 'string') card.flavor_text = normalizeCardText(card.flavor_text);
  return card;
}
