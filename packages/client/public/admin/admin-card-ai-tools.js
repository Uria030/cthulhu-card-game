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

  // 簡化卡片資料(送 AI 前裁掉冗餘欄位節省 token)
  function summarizeCardForAi(c) {
    return {
      code: c.code,
      name_zh: c.name_zh,
      faction: c.faction,
      style: c.style,
      card_type: c.card_type,
      slot: c.slot,
      level: c.level,
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

    var prompt = '你是克蘇魯神話卡牌遊戲的卡片資料分析引擎。下面這張卡的 desc_zh 可能被人類手改過,加了新效果但 effects[] 結構未跟上。\n' +
      '\n你的工作:讀 desc_zh + 現有 effects[],回傳補齊後的完整 effects[] 陣列(JSON 形式),要求:\n' +
      '1. 保留原 effects[] 中正確且仍對應 desc_zh 的項\n' +
      '2. 補上 desc_zh 提到但 effects[] 缺漏的項(每個敘述句配一個對應 effect_code)\n' +
      '3. 修正 desc_zh 與 params 數值不一致的(例 desc 寫「3 點」但 params.amount=2,以 desc 為主)\n' +
      '4. 條件式效果(如「如果 X 否則 Y」)拆成兩條 effects,各自帶 condition\n' +
      '5. 「打出費用 -2」等費用修正用 effect_code=modify_cost,params={amount:-2}\n' +
      '6. effect_code 必從以下白名單選:\n' + validCodes + '\n' +
      '\n卡片資料:\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n' +
      '\n只回 JSON,格式如下:\n{\n  "effects": [\n    {"trigger":"...", "condition":null, "cost":{...}, "target":"...", "effect_code":"...", "params":{...}, "duration":"...", "desc_zh":"...", "desc_en":"..."}\n  ],\n  "changed_summary": "簡述改了什麼"\n}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json' });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (!Array.isArray(data.effects)) throw new Error('AI 回傳 effects 非陣列');
    return data;
  }

  // ─── B:V 值重估 ─────────────
  async function aiEstimateCardValue(card) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var summary = summarizeCardForAi(card);
    var prompt = '你是卡片價值平衡分析師。讀此卡的所有資訊(包含 desc_zh 內可能藏的隱含效果),推算它的**真實 V 值**並給出推算理由。\n' +
      '\nV 值參考:\n' +
      '- 1V = 1 行動點 = 1 資源 = 抽 1 牌 = 造成 1 傷害\n' +
      '- 恐懼傷害 3V/點;恢復 HP/SAN 1.5V/點;搜牌 6V;移動 1V/格\n' +
      '- 正面狀態 3-6V/層;負面狀態 3-6V/層;快速 +1V;指定他人 +2V\n' +
      '- 條件式 -1~-2V(機率打折);費用減免 1.5V/資源\n' +
      '- 跳過動作點(不佔行動)+1V;不佔欄位(如盟友格)+2V\n' +
      '- 等級抵扣:LV0=0, LV1=-0.5V, LV2=-1V, LV3=-2V, LV4=-3V, LV5=-4V\n' +
      '- 所有卡型 1:1:稀有度抵扣 = 總 V - 等級抵扣 - 費用\n' +
      '\n卡片資料:\n```json\n' + JSON.stringify(summary, null, 2) + '\n```\n' +
      '\n只回 JSON:\n{\n' +
      '  "estimated_total_v": <number>,\n' +
      '  "breakdown": [{"effect_summary":"...", "v":<number>, "reason":"..."}],\n' +
      '  "suggested_cost": <number 0-6>,\n' +
      '  "calculated_rarity": "隨身/基礎/標準/進階/稀有/傳奇/超出範圍",\n' +
      '  "balance_diagnosis": "<對比目前 cost,卡片是 over/under/balanced 的簡述>",\n' +
      '  "notes": "<其他平衡觀察,例如『這張的條件式效果讓實際 V 偏低』>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json' });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (typeof data.estimated_total_v !== 'number') throw new Error('AI 未回傳合法 estimated_total_v');
    return data;
  }

  // ─── C:COMBO 互動性評分 ─────────────
  async function aiScoreCardCombo(card, contextCards) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var ctxLines = (contextCards || []).slice(0, 12).map(function (c) {
      return '- [' + (c.code || '?') + '] ' + (c.name_zh || '(無名)') + ' | ' + (c.card_type || '?') + ' LV' + (c.level != null ? c.level : '?') + ' cost=' + (c.cost != null ? c.cost : '?');
    }).join('\n');

    var prompt = '你是卡牌遊戲設計品質評估器。評估這張卡的軸內互動有趣程度(0-10):\n' +
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
      '\n只回 JSON:\n{\n' +
      '  "combo_score": <0-10>,\n' +
      '  "pattern": "A"|"B"|"C"|"D"|"E"|"F"|null,\n' +
      '  "why": "<為何給這個分數>",\n' +
      '  "suggestion": "<若 < 6 分,建議怎麼改寫成更有趣的;若 ≥ 7 分,寫『已達標』>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json' });
    var data = JSON.parse(stripJsonFence(resp.text));
    if (typeof data.combo_score !== 'number') throw new Error('AI 未回傳合法 combo_score');
    return data;
  }

  // ─── D:系列補位建議 ─────────────
  async function aiSuggestAxisGaps(axisLayer, axisValue, axisCards) {
    if (typeof window.callGeminiDirect !== 'function') throw new Error('callGeminiDirect 未載入');
    var summary = (axisCards || []).map(function (c) {
      return '- [' + (c.code || '?') + '] ' + (c.name_zh || '(無名)') + ' | ' + (c.card_type || '?') + ' LV' + (c.level != null ? c.level : '?') + ' cost=' + (c.cost != null ? c.cost : '?');
    }).join('\n');

    var prompt = '你是卡牌遊戲系列設計顧問。分析這個主軸的卡片分佈,建議該補什麼讓系列完整。\n' +
      '\n軸: ' + axisLayer + ' / ' + axisValue + '\n' +
      '已有 ' + (axisCards.length) + ' 張:\n' + summary + '\n' +
      '\n## 完整 RPG 角色配置應有:\n' +
      '- 至少 1 張盟友(角色本人或副手) ※ 但「角色本人」不該做成卡(玩家就是這個角色)\n' +
      '- 2-3 張資產(裝備/工具)\n' +
      '- 2-3 張事件(主動行動)\n' +
      '- 1-2 張技能(檢定加值)\n' +
      '- 等級分佈 LV0-3 各 1-2 張\n' +
      '- 至少一個明確的軸內 COMBO Pattern (A-F)\n' +
      '\n只回 JSON:\n{\n' +
      '  "current_distribution": {"asset": <n>, "event": <n>, "skill": <n>, "ally": <n>},\n' +
      '  "level_distribution": {"LV0": <n>, "LV1": <n>, "LV2": <n>, "LV3": <n>, "LV4": <n>, "LV5": <n>},\n' +
      '  "missing_categories": ["<例:LV2 事件>", "<例:LV3 技能>"],\n' +
      '  "next_three_suggestions": [\n' +
      '    {"name_zh":"...","card_type":"...","level":<n>,"cost":<n>,"why":"<為何補這張>","sketch":"<效果草圖>"},\n' +
      '    {...}, {...}\n' +
      '  ],\n' +
      '  "summary": "<整體建議>"\n' +
      '}\n';

    var resp = await window.callGeminiDirect({ prompt: prompt, model: 'gemini-2.5-flash', responseMimeType: 'application/json' });
    var data = JSON.parse(stripJsonFence(resp.text));
    return data;
  }

  window.aiRestructureEffects = aiRestructureEffects;
  window.aiEstimateCardValue = aiEstimateCardValue;
  window.aiScoreCardCombo = aiScoreCardCombo;
  window.aiSuggestAxisGaps = aiSuggestAxisGaps;
})();
