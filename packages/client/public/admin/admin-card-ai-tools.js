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
    var validCodes = 'deal_damage, deal_horror, heal_hp, heal_san, draw_card, search_deck, retrieve_card, return_to_deck, discard_card, gain_resource, spend_resource, modify_cost, move_investigator, swap_position, engage_enemy, disengage_enemy, exhaust_card, ready_card, stun_enemy, add_status, remove_status, make_test, modify_test, reroll, auto_success, attack, evade, taunt, counterattack, place_clue, discover_clue, place_doom, remove_doom, spawn_enemy, remove_enemy, look_chaos_bag, manipulate_chaos_bag, fast_play, target_other, add_bless, add_curse, remove_bless, remove_curse';

    var prompt = '你是克蘇魯神話卡牌遊戲的卡片資料分析引擎。下面這張卡可能被人類手改過 desc_zh 加了新效果但 effects[] 結構未跟上。\n' +
      '\n**全程必須使用繁體中文回覆**(包括 changed_summary 與 desc_zh)。\n' +
      '\n你的工作:讀 card_preview_text(這是使用者看到的卡面文字,優先依此判斷)+ 現有 effects[],回傳補齊後的完整 effects[] 陣列(JSON),要求:\n' +
      '1. 保留原 effects[] 中正確且仍對應卡面敘述的項\n' +
      '2. 補上敘述提到但 effects[] 缺漏的項(每個敘述句配一個對應 effect_code)\n' +
      '3. 修正 desc_zh 與 params 數值不一致的(例敘述寫「3 點」但 params.amount=2,以敘述為主)\n' +
      '4. 條件式效果(如「如果 X 否則 Y」)拆成兩條 effects,各自帶 condition\n' +
      '5. 「打出費用 -2」等費用修正用 effect_code=modify_cost,params={amount:-2}\n' +
      '6. effect_code 必從以下白名單選:\n' + validCodes + '\n' +
      '\n卡片資料:\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n' +
      '\n只回 JSON,格式:\n{\n  "effects": [\n    {"trigger":"...", "condition":null, "cost":{...}, "target":"...", "effect_code":"...", "params":{...}, "duration":"...", "desc_zh":"...", "desc_en":"..."}\n  ],\n  "changed_summary": "用繁體中文簡述改了什麼"\n}\n';

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
