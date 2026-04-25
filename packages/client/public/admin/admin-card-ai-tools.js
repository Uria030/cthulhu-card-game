/* ========================================
   MOD-14 卡片檢查器 Part 3 — AI 重估工具
   依賴 window.callGeminiDirect (geminiDirectClient.js 提供)

   四個 AI 動作:
   - aiRestructureEffects(card) — 讀 desc_zh 反向補齊 effects[]
   - aiEstimateCardValue(card) — 推算真實 V 值含理由
   - aiScoreCardCombo(card, contextCards) — 軸內互動性評分 0-10
   - aiSuggestAxisGaps(axisCards) — 系列補位建議
   ======================================== */
(function () {
  'use strict';

  function stripJsonFence(text) {
    return String(text).replace(/```json\n?|```/g, '').trim();
  }

  // 把 effects[].desc_zh 串成單一字串,讓 AI 一眼看到所有敘述(避免 AI 漏看 nested struct 裡的 desc_zh)
  function renderCardBodyText(c) {
    var lines = [];
    if (Array.isArray(c.effects)) {
      c.effects.forEach(function (e, i) {
        if (e && e.desc_zh && String(e.desc_zh).trim()) {
          lines.push('【效果' + (i + 1) + '】' + e.desc_zh);
        }
      });
    }
    if (c.flavor_text && String(c.flavor_text).trim()) {
      lines.push('【風味文字】' + c.flavor_text);
    }
    return lines.length > 0 ? lines.join('\n') : '(此卡 effects.desc_zh 與 flavor_text 都為空,只能依 effects[].effect_code + params 結構化資料推算)';
  }

  // 簡化卡片資料(送 AI 前裁掉冗餘欄位節省 token)
  function summarizeCardForAi(c) {
    return {
      // 把使用者實際看到的卡面文字優先放在最上方,逼 AI 必讀
      card_preview_text: renderCardBodyText(c),
      code: c.code,
      name_zh: c.name_zh,
      faction: c.faction,
      style: c.style,
      card_type: c.card_type,
      slot: c.slot,
      level: (c.starting_xp ?? c.level), starting_xp: (c.starting_xp ?? c.level),
      cost: c.cost,
      damage: c.damage,
      horror: c.horror,
      weapon_tier: c.weapon_tier,
      ammo: c.ammo,
      uses: c.uses,
      combat_style: c.combat_style,
      attribute_modifiers: c.attribute_modifiers,
      ally_hp: c.ally_hp,
      ally_san: c.ally_san,
      consume_type: c.consume_type,
      flavor_text: c.flavor_text,
      primary_axis_layer: c.primary_axis_layer,
      primary_axis_value: c.primary_axis_value,
      is_signature: c.is_signature,
      is_unique: c.is_unique,
      is_revelation: c.is_revelation,
      is_permanent: c.is_permanent,
      is_extra: c.is_extra,
      is_talisman: c.is_talisman,
      effects: (c.effects || []).map(function (e) {
        return {
          trigger: e.trigger,
          condition: e.condition,
          cost: e.cost,
          target: e.target,
          effect_code: e.effect_code,
          params: e.params,
          duration: e.duration,
          desc_zh: e.desc_zh,
        };
      }),
    };
  }

  // ─── A:effects[] 反向結構化 ─────────────
  async function aiRestructureEffects(card) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var summary = summarizeCardForAi(card);
    var validCodes = 'deal_damage, deal_horror, heal_hp, heal_san, draw_card, search_deck, retrieve_card, return_to_deck, discard_card, gain_resource, spend_resource, modify_cost, move_investigator, swap_position, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, wild_attr_boost, reroll, auto_success, attack, evade, taunt, counterattack, place_clue, discover_clue, place_doom, remove_doom, spawn_enemy, remove_enemy, look_chaos_bag, manipulate_chaos_bag, fast_play, target_other, add_bless, add_curse, remove_bless, remove_curse';

    var prompt = '你是克蘇魯神話卡牌遊戲的卡片資料分析引擎。下面這張卡可能被人類手改過 desc_zh 加了新效果但 effects[] 結構未跟上。\n' +
      '\n**全程必須使用繁體中文回覆**。\n' +
      '\n## 你的工作範圍(極重要,違反就是嚴重失誤)\n' +
      '\n你**只**負責補齊每條 desc_zh 對應的 effects[] 結構(trigger / condition / cost / target / effect_code / params / duration)。你**不負責**改寫敘述文字 / 卡名 / 風味文字。\n' +
      '\n**禁止行為(絕對不能做)**:\n' +
      '- ❌ 改寫 desc_zh 文字內容(只能拆句、不能改字眼)\n' +
      '- ❌ 改寫 name_zh / name_en\n' +
      '- ❌ 改寫 flavor_text\n' +
      '- ❌ 重新「翻譯」或「潤飾」原有句子\n' +
      '- ❌ 用同義詞替換規則術語(例「心智創傷」「精神創傷」「神智創傷」「心靈創傷」「理智損失」全部禁用,本專案標準術語只有「恐懼」「N 點恐懼」「N 點 SAN」)\n' +
      '- ❌ 自創不存在於 s06 規範的詞彙\n' +
      '\n## 標準術語白名單(s06 規範)\n' +
      '- 傷害類:「N 點傷害」「N 點恐懼」(必加「點」)\n' +
      '- 恢復類:「治癒 N 點傷害」「治癒 N 點恐懼」(不能用「治療」「補」「回復」「恢復」)\n' +
      '- SAN 上限:「N 點 SAN 上限」(不能用「心智上限」)\n' +
      '- 屬性禁忌:單獨用「心智」屬於禁止替代詞,八屬性是 力 / 敏 / 體 / 反應 / 智 / 意 / 感 / 魅\n' +
      '- 資源類:「N 個資源」「抽 N 張卡」「N 點行動點」「N 個線索」「N 點毀滅標記」「N 個祝福」「N 個詛咒」\n' +
      '- 萬能加值:「所有屬性檢定 +N」「所有技能檢定 +N」(對應 wild_attr_boost effect_code)\n' +
      '\n## 拆解原則\n' +
      '1. **desc_zh 必須是原文逐句拆出**:把 card_preview_text 拆成 N 條,每條獨立成一個 effect 物件,該 effect 的 desc_zh = 該條原文(只拆不改字)\n' +
      '2. 補上 effects[] 缺漏的結構欄位(trigger / condition / cost / target / effect_code / params / duration)\n' +
      '3. 修正 params 數值與 desc 不一致時,**改 params 對齊 desc**(不是反過來改 desc)\n' +
      '4. 條件式效果(「如果 X 否則 Y」)拆成兩條 effects,各自帶 condition\n' +
      '5. 「打出費用 -2」用 effect_code=modify_cost,params={amount:-2}\n' +
      '6. 「全屬性 +N / 全技能 +N」用 effect_code=wild_attr_boost,params.amount\n' +
      '7. 「指定屬性檢定 +N」用 modify_test,params.modifier + 可選 attribute\n' +
      '8. effect_code 必從以下白名單選:\n' + validCodes + '\n' +
      '\n## 改動最小原則\n' +
      '若原 effects[] 中某項已正確對應 desc 的某句,**完全不要動該項**。只新增缺漏項或補齊 params。\n' +
      '\n## 輸出格式\n' +
      '只回 JSON,**不要 markdown 包裝**:\n' +
      '```\n' +
      '{\n' +
      '  "effects": [\n' +
      '    {"trigger":"...", "condition":null, "cost":{...}, "target":"...", "effect_code":"...", "params":{...}, "duration":"...", "desc_zh":"<原文拆出的句子,不改字>", "desc_en":"..."}\n' +
      '  ],\n' +
      '  "changed_summary": "<繁中:具體列出哪些 effects[] 補了哪些結構,例:effect#2 補上 effect_code=add_status + params.stacks=1。不要含『改寫敘述』『重新撰寫』等字眼,因為你不該做那些事>"\n' +
      '}\n' +
      '```\n' +
      '\n卡片資料:\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json', temperature: 0.4 });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (!Array.isArray(data.effects)) throw new Error('AI 回傳 effects 非陣列');
    return data;
  }

  // ─── B:V 值重估 ─────────────
  async function aiEstimateCardValue(card) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var summary = summarizeCardForAi(card);
    var prompt = '你是卡片價值平衡分析師。推算此卡的**真實 V 值**。\n' +
      '\n**全程必須使用繁體中文回覆**。所有 effect_summary / reason / balance_diagnosis / notes 都用繁體中文,不要混雜英文。\n' +
      '\n**閱讀順序(必遵)**:\n' +
      '1. 優先讀 `card_preview_text` —— 這是玩家實際看到的卡面文字,以此為判斷主軸\n' +
      '2. 對照 effects[] 結構化資料補強細節\n' +
      '3. 若 card_preview_text 與 effects[].params 衝突,以 card_preview_text 為準\n' +
      '4. 若 card_preview_text 含「不佔盟友格 / 不佔欄位 / 永久 / 每回合」等強力字眼,務必反映在 V 值\n' +
      '\nV 值規則:\n' +
      '- 1V = 1 行動點 = 1 資源 = 抽 1 牌 = 造成 1 傷害\n' +
      '- 恐懼傷害 3V/點;恢復 HP/SAN 1.5V/點;搜牌 6V;移動 1V/格\n' +
      '- 正面狀態 3-6V/層;負面狀態 3-6V/層;快速 +1V;指定他人 +2V\n' +
      '- 條件式 -1~-2V(機率打折,但若條件易達成不打折);費用減免 1.5V/資源\n' +
      '- 跳過動作點(不佔行動)+1V;不佔欄位(如盟友格)+2V\n' +
      '- **起始投入抵扣**(取代舊版等級抵扣):starting_xp 點數 × 1V 線性。即 ★0=0, ★1=-1V, ★2=-2V, ★3=-3V, ★4=-4V, ★5=-5V\n' +
      '- Exceptional 標記額外 -2V(沿用)\n' +
      '- 所有卡型 1:1:稀有度抵扣 = 總 V - 起始投入抵扣 - 費用 - Exceptional 抵扣\n' +
      '- 萬能屬性加值表 WILD_ATTR_VALUE: +1=1V, +2=3V, +3=6V, +4=9V, +5=13.5V (本專案 8 屬性,但表已校準,直接套)\n' +
      '\n**§4.4 成長型被動估值(s04 規範)**:\n' +
      '- 4.4a **有限充能槽型**(層數有限/每層獨立):效果價值 = Σ每層靜態價值 + 每層代價\n' +
      '- 4.4b **持續性成長型**(永久被動/每層覆蓋下層/影響每次檢定):\n' +
      '  · 效果價值 = **最終可達狀態的單次效果價值 × 持續性權重** + Σ每層附帶代價/收益\n' +
      '  · 持續性權重 = 預期留場回合數(預設 4) × 每回合預期觸發次數\n' +
      '  · 影響每次檢定 → 每回合 2 次 → **權重 ×8**\n' +
      '  · 每回合自動觸發一次 → **權重 ×4**\n' +
      '  · 一次性效果 → 權重 ×1(回到靜態查表)\n' +
      '  · 範例:Key of Ys 最終狀態 wild +3 = 6V × 8 = 48V;吸收 3 恐懼 +1.5V;棄 10 牌 -5V → 淨 44.5V(超出傳奇)\n' +
      '- **永久效果預設套 4.4b**:遇到 duration=permanent / while_in_play 且 effect 影響每次檢定/每回合的卡,務必套持續性權重\n' +
      '- **同一張卡每次估算應該得到相同 V 值**——你的推算過程必須穩定可重現\n' +
      '\n卡片資料:\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n' +
      '\n只回 JSON,**所有字串欄位用繁體中文**:\n{\n' +
      '  "estimated_total_v": <number>,\n' +
      '  "breakdown": [{"effect_summary":"<繁中>", "v":<number>, "reason":"<繁中>"}],\n' +
      '  "suggested_cost": <number 0-6>,\n' +
      '  "calculated_rarity": "隨身/基礎/標準/進階/稀有/傳奇/超出範圍",\n' +
      '  "balance_diagnosis": "<繁中:對比目前 cost,卡片是超值 / 略超值 / 平衡 / 略過弱 / 過弱>",\n' +
      '  "notes": "<繁中:其他平衡觀察>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json', temperature: 0.2 });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (typeof data.estimated_total_v !== 'number') throw new Error('AI 未回傳合法 estimated_total_v');
    return data;
  }

  // ─── C:COMBO 互動性評分 ─────────────
  async function aiScoreCardCombo(card, contextCards) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var ctxLines = (contextCards || []).slice(0, 12).map(function (c) {
      return '- [' + (c.code || '?') + '] ' + (c.name_zh || '(無名)') + ' | ' + (c.card_type || '?') + ' ★' + (((c.starting_xp ?? c.level) != null) ? (c.starting_xp ?? c.level) : '?') + ' cost=' + (c.cost != null ? c.cost : '?');
    }).join('\n');

    var prompt = '你是卡牌遊戲設計品質評估器。評估這張卡的軸內互動有趣程度(0-10)。\n' +
      '\n**全程必須使用繁體中文回覆**(why / suggestion 等所有字串欄位)。\n' +
      '\n**閱讀重點**:讀 card_preview_text 看實際卡面敘述,不要只看 effects[] 結構。\n' +
      '\n## 軸內互動 6 種 Pattern (本專案標準):\n' +
      'A 資源回收 — 從棄牌堆/移除區撈同軸卡\n' +
      'B 質變閾值 — 場上 N 張同軸卡解鎖新能力\n' +
      'C 連鎖反應 — 打 A 抽 B,B 回手下回合再打\n' +
      'D 跨時機配合 — 反應時機觸發 → 下回合開始觸發\n' +
      'E 成本轉移 — 此卡可棄置同軸卡降費或強化\n' +
      'F 鏡像效果 — 同軸 A 卡啟用時,B 卡反過來觸發\n' +
      '\n## 評分標準:\n' +
      '- 0-3 分:純機械加值(+1 攻擊/+1 檢定),無 pattern\n' +
      '- 4-6 分:有條件式加值或弱 pattern\n' +
      '- 7-10 分:明確套用 6 種 Pattern 之一,創造玩家抉擇\n' +
      '\n## 待評卡:\n' + JSON.stringify(summarizeCardForAi(card), null, 2) + '\n' +
      '\n## 同軸其他卡(對比):\n' + (ctxLines || '(無)') + '\n' +
      '\n只回 JSON,**所有字串用繁體中文**:\n{\n' +
      '  "combo_score": <0-10>,\n' +
      '  "pattern": "A"|"B"|"C"|"D"|"E"|"F"|null,\n' +
      '  "why": "<繁中:為何給這個分數>",\n' +
      '  "suggestion": "<繁中:若 < 6 分建議怎麼改寫成更有趣的;若 ≥ 7 分寫『已達標』>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json', temperature: 0.2 });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (typeof data.combo_score !== 'number') throw new Error('AI 未回傳合法 combo_score');
    return data;
  }

  // ─── D:系列補位建議 ─────────────
  async function aiSuggestAxisGaps(axisLayer, axisValue, axisCards) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var summary = (axisCards || []).map(function (c) {
      return '- [' + (c.code || '?') + '] ' + (c.name_zh || '(無名)') + ' | ' + (c.card_type || '?') + ' ★' + (((c.starting_xp ?? c.level) != null) ? (c.starting_xp ?? c.level) : '?') + ' cost=' + (c.cost != null ? c.cost : '?');
    }).join('\n');

    var prompt = '你是卡牌遊戲系列設計顧問。分析這個主軸的卡片分佈,建議該補什麼讓系列完整。\n' +
      '\n**全程必須使用繁體中文回覆**(name_zh / why / sketch / summary 等所有字串)。\n' +
      '\n軸: ' + axisLayer + ' / ' + axisValue + '\n' +
      '已有 ' + (axisCards.length) + ' 張:\n' + summary + '\n' +
      '\n## 完整 RPG 角色配置應有:\n' +
      '- 至少 1 張盟友(角色本人或副手) ※ 但「角色本人」不該做成卡(玩家就是這個角色)\n' +
      '- 2-3 張資產(裝備/工具)\n' +
      '- 2-3 張事件(主動行動)\n' +
      '- 1-2 張技能(檢定加值)\n' +
      '- 等級分佈 LV0-3 各 1-2 張\n' +
      '- 至少一個明確的軸內 COMBO Pattern (A-F)\n' +
      '\n只回 JSON,**所有字串用繁體中文**:\n{\n' +
      '  "current_distribution": {"asset": <n>, "event": <n>, "skill": <n>, "ally": <n>},\n' +
      '  "level_distribution": {"LV0": <n>, "LV1": <n>, "LV2": <n>, "LV3": <n>, "LV4": <n>, "LV5": <n>},\n' +
      '  "missing_categories": ["<繁中,例:LV2 事件>", "<繁中,例:LV3 技能>"],\n' +
      '  "next_three_suggestions": [\n' +
      '    {"name_zh":"<繁中卡名>","card_type":"...","level":<n>,"cost":<n>,"why":"<繁中:為何補這張>","sketch":"<繁中:效果草圖>"},\n' +
      '    {...}, {...}\n' +
      '  ],\n' +
      '  "summary": "<繁中:整體建議>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json', temperature: 0.3 });
    var data = JSON.parse(stripJsonFence(resp.text));
    return data;
  }

  window.aiRestructureEffects = aiRestructureEffects;
  window.aiEstimateCardValue = aiEstimateCardValue;
  window.aiScoreCardCombo = aiScoreCardCombo;
  window.aiSuggestAxisGaps = aiSuggestAxisGaps;
})();
