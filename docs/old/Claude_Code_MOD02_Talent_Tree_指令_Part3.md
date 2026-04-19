# Claude Code 指令：天賦樹設計器 MOD-02（Part 3/3）
## Talent Tree Designer Instructions — AI Generation & Visual Implementation

> **給 Claude Code：** 本文件是 MOD-02 天賦樹設計器的第三部分，
> 定義 AI 生成系統和天賦樹視覺化的實作細節。
> 請先完成 Part 1（資料庫）和 Part 2（API + 頁面）再執行本文件。

---

# 第十一部分：AI 生成（Gemini 2.5 Flash）

## 11.1 設定

與 MOD-01 共用 Gemini API Key（localStorage key: `gemini_api_key`）。

## 11.2 兩種生成模式

### 模式 A：AI 生成單一節點效果

觸發：節點詳細編輯區的 [AI 生成效果] 按鈕

```
┌─────────────────────────────────────────────────┐
│  AI 生成節點效果                                   │
│                                                   │
│  陣營：{faction_name_zh}（{faction_code}）         │
│  分支：{branch_name_zh}                            │
│  等級：Lv{level}                                   │
│  節點類型：{node_type_zh}                          │
│                                                   │
│  設計方向補充（可選）：                             │
│  ┌───────────────────────────────────────┐       │
│  │  例如：偏重團隊增益、配合指揮官主題... │       │
│  └───────────────────────────────────────┘       │
│                                                   │
│  [生成] [取消]                                     │
└─────────────────────────────────────────────────┘
```

### 模式 B：AI 生成完整分支（10 個節點）

觸發：分支卡片的 [AI 生成] 按鈕或工具列的 [AI 生成分支]

一次生成 Lv3-12 共 10 個節點的完整效果，含名稱、描述、效果代碼和價值估算。

## 11.3 Prompt 設計

### 單一節點生成 Prompt

```
你是一個克蘇魯神話合作卡牌遊戲的系統設計師。請為天賦樹中的一個節點設計效果。

## 遊戲背景
- 1–4 人合作，克蘇魯神話世界觀
- 天賦樹是角色的個人成長路徑，花費天賦點解鎖被動能力節點
- 八陣營各有一棵 12 級天賦樹，每棵有 3 條分支路線
- 天賦點來源：完成章節、達成個人秘密任務
- 陣營 = 職業，天賦樹 = 職業等級表

## 天賦樹結構
- Lv1-2：共通主幹（所有分支共享）
- Lv3：分支選擇點（三選一，選定後鎖定）
- Lv3 是第一個質變點 — 角色開始獨當一面
- Lv6 是第二個質變點 — 分支核心能力上線
- Lv5/8：專精解鎖
- Lv9：天賦卡（簽名卡）解鎖
- Lv2/7/10/11/12：屬性提升
- Lv12：終極天賦（超凡入聖）

## 數值體系
- d20 系統，屬性修正 1:1（屬性值 = 修正值）
- 三層疊加：屬性修正 + 熟練/專精 + 裝備/卡牌
- 初期 +4 / 中期 +8 / 後期 +12 / 巔峰 +17
- 1V = 1 行動點 = 1 資源 = 抽 1 張 = 造成 1 傷害

## 設計對象
陣營：{faction_code} {faction_name_zh}（{faction_name_en}）
陣營特色：{faction_description_zh}
主屬性：{primary_attribute} / 副屬性：{secondary_attribute}
主戰鬥熟練：{combat_proficiency_primary}

分支路線：{branch_name_zh}（{branch_name_en}）
分支主題：{branch_theme_keywords}

目前設計的節點：
- 等級：Lv{level}
- 節點類型：{node_type}
- 前一級節點效果：{prev_node_description}（提供上下文）

設計方向補充：{user_input}

## 設計原則
1. **漸進式成長** — 低級節點給基礎能力，高級節點給強力但不破格的效果
2. **分支差異化** — 同陣營的三條分支應該有明顯不同的打法風格
3. **被動為主** — 天賦節點的效果以「永久被動」為主，不是一次性效果
4. **天賦 vs 經驗值** — 天賦加詞條（做到新的事），經驗值加數值（做得更好）
5. **不破壞紅線** — 不能產生無限循環、不能消滅挑戰
6. **合作導向** — 部分天賦應該鼓勵團隊合作

## 輸出格式
請回傳以下 JSON，不要回傳其他任何文字：
{
  "name_zh": "節點名稱（2-4 字）",
  "name_en": "Node Name",
  "description_zh": "節點效果的完整描述",
  "description_en": "English description",
  "effects": [
    {
      "effect_code": "效果代碼（使用卡片效果語言體系）",
      "effect_params": { "參數": "值" },
      "effect_desc_zh": "單一效果的中文描述",
      "effect_desc_en": "English",
      "effect_value": 1.5
    }
  ],
  "design_notes": "設計思路說明"
}
```

### 完整分支生成 Prompt

```
你是一個克蘇魯神話合作卡牌遊戲的系統設計師。
請為天賦樹的一條完整分支路線（Lv3 到 Lv12，共 10 個節點）設計效果。

## 遊戲背景
（同上，省略重複）

## 設計對象
陣營：{faction_code} {faction_name_zh}
分支路線：{branch_name_zh}（{branch_name_en}）
分支主題：{branch_theme_keywords}
分支描述：{branch_description_zh}

主幹效果（已確定，作為分支設計的基礎）：
- Lv1 基礎本能：{lv1_description}
- Lv2 屬性覺醒 I：{primary_attribute} +1

設計方向補充：{user_input}

## 節點類型限制
- Lv3：branch_choice — 分支入門能力，選擇此分支的理由
- Lv4：passive — 分支被動能力
- Lv5：proficiency — 解鎖戰鬥專精
- Lv6：milestone — 質變能力（分支核心上線，打法質變）
- Lv7：attribute_boost — 屬性提升（指定哪個屬性 +1）
- Lv8：proficiency — 進階專精
- Lv9：talent_card — 天賦卡解鎖（只需描述天賦卡的概念方向）
- Lv10：attribute_boost — 屬性提升
- Lv11：passive — 高階被動（含屬性提升 +1）
- Lv12：ultimate — 終極天賦（超凡入聖，含屬性提升 +1）

## 設計原則
1. **10 個節點要形成一條完整的成長弧線** — 從入門到超凡的故事
2. **Lv3 讓玩家想選這條分支** — 入門能力要有吸引力
3. **Lv6 是打法質變點** — 這裡開始和其他分支產生實質差異
4. **Lv9 天賦卡是分支的標誌性簽名卡** — 代表這條路線的精髓
5. **Lv12 是超凡入聖** — 滿等角色能正面對抗巨頭級怪物

## 輸出格式
請回傳以下 JSON，不要回傳其他任何文字：
{
  "branch_summary": "這條分支的一句話總結",
  "nodes": [
    {
      "level": 3,
      "node_type": "branch_choice",
      "name_zh": "...",
      "name_en": "...",
      "description_zh": "...",
      "description_en": "...",
      "effects": [
        {
          "effect_code": "...",
          "effect_params": {},
          "effect_desc_zh": "...",
          "effect_desc_en": "...",
          "effect_value": 1.0
        }
      ],
      "boost_attribute": null,
      "proficiency_code": null,
      "talent_card_concept": null,
      "design_notes": "..."
    },
    { "level": 4, ... },
    { "level": 5, ..., "proficiency_code": "shooting_rifle" },
    { "level": 6, ... },
    { "level": 7, ..., "boost_attribute": "charisma" },
    { "level": 8, ..., "proficiency_code": "shooting_dual_wield" },
    { "level": 9, ..., "talent_card_concept": "一張天賦卡的設計概念描述" },
    { "level": 10, ..., "boost_attribute": "strength" },
    { "level": 11, ..., "boost_attribute": "perception" },
    { "level": 12, ..., "boost_attribute": "charisma" }
  ]
}
```

## 11.4 後處理

API 回傳後：
1. 解析 JSON
2. 驗證 nodes 陣列長度正確（單節點 = 1，完整分支 = 10）
3. 驗證 level 值在合法範圍
4. 驗證 effect_code 在卡片效果語言的合法清單中
5. 填入表單對應欄位
6. 使用者可自由修改後再儲存

## 11.5 錯誤處理

與 MOD-01 一致。

---

# 第十二部分：天賦樹視覺化實作

## 12.1 技術方案

使用 **純 HTML Canvas** 或 **SVG** 繪製天賦樹（不引入額外框架）。

推薦 SVG 方案 — 每個節點是一個 SVG `<g>` 群組，容易綁定事件和動態更新。

## 12.2 佈局演算法

```javascript
// 天賦樹佈局計算
function calculateTreeLayout(nodes, branches) {
  const TRUNK_X = 400;           // 主幹 X 座標（畫布中央）
  const LEVEL_HEIGHT = 80;       // 每級高度間距
  const BRANCH_SPREAD = 200;     // 分支水平間距
  const NODE_RADIUS = 28;        // 節點半徑
  
  const positions = {};
  
  for (const node of nodes) {
    const y = 40 + node.level * LEVEL_HEIGHT;
    
    if (node.is_trunk) {
      // 主幹節點置中
      positions[node.id] = { x: TRUNK_X, y };
    } else {
      // 分支節點依分支索引水平偏移
      const branchIndex = branches.findIndex(b => b.id === node.branch_id);
      const offsetX = (branchIndex - 1) * BRANCH_SPREAD; // -1, 0, +1
      positions[node.id] = { x: TRUNK_X + offsetX, y };
    }
  }
  
  return positions;
}
```

## 12.3 SVG 節點渲染

```javascript
function renderNode(svgGroup, node, position, isSelected) {
  const nodeTypeConfig = NODE_TYPES[node.node_type];
  const statusColors = {
    complete: nodeTypeConfig.color,
    draft: '#C9A84C',
    pending: 'var(--bg-card)'
  };
  
  // 節點圓角方塊
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', position.x - 24);
  rect.setAttribute('y', position.y - 24);
  rect.setAttribute('width', 48);
  rect.setAttribute('height', 48);
  rect.setAttribute('rx', 8);
  rect.setAttribute('fill', statusColors[node.design_status] || statusColors.pending);
  rect.setAttribute('fill-opacity', node.design_status === 'complete' ? '0.3' : '0.15');
  rect.setAttribute('stroke', isSelected ? '#C9A84C' : '#2A2A44');
  rect.setAttribute('stroke-width', isSelected ? '3' : '1');
  rect.setAttribute('cursor', 'pointer');
  
  // 等級數字
  const levelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  levelText.setAttribute('x', position.x - 20);
  levelText.setAttribute('y', position.y - 12);
  levelText.setAttribute('font-size', '10');
  levelText.setAttribute('fill', 'var(--text-secondary)');
  levelText.textContent = `Lv${node.level}`;
  
  // 節點類型圖示（文字代替，正式版用圖示）
  const typeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  typeIcon.setAttribute('x', position.x);
  typeIcon.setAttribute('y', position.y + 4);
  typeIcon.setAttribute('text-anchor', 'middle');
  typeIcon.setAttribute('font-size', '16');
  typeIcon.setAttribute('fill', 'var(--text-primary)');
  
  const icons = {
    passive: '◆', attribute_boost: '▲', proficiency: '⚔',
    talent_card: '★', branch_choice: '◈', milestone: '✦', ultimate: '✹'
  };
  typeIcon.textContent = icons[node.node_type] || '●';
  
  // 節點名稱
  const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  nameText.setAttribute('x', position.x);
  nameText.setAttribute('y', position.y + 36);
  nameText.setAttribute('text-anchor', 'middle');
  nameText.setAttribute('font-size', '11');
  nameText.setAttribute('fill', 'var(--text-secondary)');
  nameText.textContent = node.name_zh.length > 6 
    ? node.name_zh.substring(0, 6) + '...' 
    : node.name_zh;
  
  svgGroup.appendChild(rect);
  svgGroup.appendChild(levelText);
  svgGroup.appendChild(typeIcon);
  svgGroup.appendChild(nameText);
  
  // 點擊事件
  svgGroup.addEventListener('click', () => selectNode(node));
}
```

## 12.4 連線渲染

```javascript
function renderConnections(svg, nodes, positions, branches) {
  // 主幹連線（白色）
  const trunkNodes = nodes.filter(n => n.is_trunk).sort((a, b) => a.level - b.level);
  for (let i = 0; i < trunkNodes.length - 1; i++) {
    drawLine(svg, 
      positions[trunkNodes[i].id], 
      positions[trunkNodes[i + 1].id], 
      '#8A8778', 2);
  }
  
  // 主幹到分支選擇點的連線
  const lv2Node = trunkNodes.find(n => n.level === 2);
  const lv3Nodes = nodes.filter(n => n.level === 3 && !n.is_trunk);
  
  for (const lv3 of lv3Nodes) {
    const branch = branches.find(b => b.id === lv3.branch_id);
    drawLine(svg, 
      positions[lv2Node.id], 
      positions[lv3.id], 
      branch?.color_hex || '#8A8778', 2);
  }
  
  // 分支內部連線
  for (const branch of branches) {
    const branchNodes = nodes
      .filter(n => n.branch_id === branch.id)
      .sort((a, b) => a.level - b.level);
    
    for (let i = 0; i < branchNodes.length - 1; i++) {
      drawLine(svg, 
        positions[branchNodes[i].id], 
        positions[branchNodes[i + 1].id], 
        branch.color_hex, 2);
    }
  }
}

function drawLine(svg, from, to, color, width) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y + 24); // 從節點底部出發
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y - 24);   // 到下一節點頂部
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', width);
  line.setAttribute('stroke-opacity', '0.6');
  svg.insertBefore(line, svg.firstChild); // 連線在節點下方
}
```

## 12.5 SVG 畫布設定

```javascript
function initTreeCanvas(container) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '1200'); // 12 級 × 80px + 邊距
  svg.setAttribute('viewBox', '0 0 800 1200');
  svg.style.background = 'transparent';
  
  // 支援拖曳和縮放
  let viewBox = { x: 0, y: 0, w: 800, h: 1200 };
  let isDragging = false;
  let startPoint = { x: 0, y: 0 };
  
  svg.addEventListener('mousedown', (e) => {
    if (e.target === svg) { // 只在空白處拖曳
      isDragging = true;
      startPoint = { x: e.clientX, y: e.clientY };
    }
  });
  
  svg.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = (e.clientX - startPoint.x) * (viewBox.w / svg.clientWidth);
      const dy = (e.clientY - startPoint.y) * (viewBox.h / svg.clientHeight);
      viewBox.x -= dx;
      viewBox.y -= dy;
      svg.setAttribute('viewBox', 
        `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
      startPoint = { x: e.clientX, y: e.clientY };
    }
  });
  
  svg.addEventListener('mouseup', () => isDragging = false);
  svg.addEventListener('mouseleave', () => isDragging = false);
  
  // 滾輪縮放
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 1.1 : 0.9;
    const cx = viewBox.x + viewBox.w / 2;
    const cy = viewBox.y + viewBox.h / 2;
    viewBox.w *= scale;
    viewBox.h *= scale;
    viewBox.x = cx - viewBox.w / 2;
    viewBox.y = cy - viewBox.h / 2;
    svg.setAttribute('viewBox', 
      `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  });
  
  container.appendChild(svg);
  return svg;
}
```

## 12.6 Tooltip 實作

```javascript
function showNodeTooltip(node, position, event) {
  const tooltip = document.getElementById('tree-tooltip') 
    || createTooltip();
  
  const effectSummary = node.effects?.length 
    ? node.effects.map(e => `· ${e.effect_desc_zh} (${e.effect_value}V)`).join('\n')
    : '（尚未設計效果）';
  
  tooltip.innerHTML = `
    <div class="tooltip-header">${node.name_zh}</div>
    <div class="tooltip-type">${NODE_TYPES[node.node_type].zh} · Lv${node.level}</div>
    <div class="tooltip-cost">花費：${node.talent_point_cost} 天賦點</div>
    <div class="tooltip-desc">${node.description_zh || '待設計'}</div>
    <div class="tooltip-effects">${effectSummary}</div>
  `;
  
  tooltip.style.left = `${event.pageX + 12}px`;
  tooltip.style.top = `${event.pageY + 12}px`;
  tooltip.style.display = 'block';
}
```

---

# 第十三部分：完成後（全部三個 Part）

1. 執行 Part 1 的 Seed Data 腳本
2. 執行 Part 2 的 API 路由註冊
3. 執行 Part 3 的前端視覺化組件
4. 測試完整流程：
   - 選擇陣營 → 載入天賦樹 → 視覺化顯示 → 點擊節點 → 編輯效果 → 儲存
   - AI 生成單一節點效果
   - AI 生成完整分支（10 個節點）
   - 陣營比較面板（屬性矩陣、熟練矩陣）
5. 確認響應式佈局
6. 確認修正 `investigator_templates` 的屬性總點數約束（21 → 18）
7. Git commit：`feat: implement talent tree designer (MOD-02) — 8 faction trees, 12-level structure, 3-branch routes, visual SVG editor, AI generation, faction comparison`
8. 更新 index.html 中 MOD-02 的狀態標籤從 `PLANNED` 改為 `READY`
9. Push 到 GitHub

---

# 附錄：相關文件

- 《成長子系統設計 v0.1》— 天賦樹完整設計（GDD05 產出，規則書整合時遺漏）
- 《規則書 v1.0 第一章》§2 支柱 5 — 成長子系統定位
- 《規則書 v1.0 第一章》§2 支柱 1 — 陣營與構築（八陣營機制關鍵字）
- 《規則書 v1.0 第四章》§1 — 五條成長路徑
- 《規則書 v1.0 第六章》§10 — 30 種戰鬥專精代碼表
- 《規則書 v1.0 第六章》§15 — 待設計：天賦點獲取量
- 《支柱一：陣營與構築 v0.1》— 八陣營詳細定義
- 《資料庫結構設計 v0.1》§3 — 調查員模組
- 《補充 02：卡片效果語言》— 效果代碼體系（天賦節點效果沿用）
- 《卡片價值計算規範 v1.1》— 效果價值速查表（天賦節點估值參考）

> **重要備註：**
> 1. `成長子系統設計 v0.1` 在規則書 v1.0 整合時被遺漏，未合併入第四章。
>    本設計器的規格以該文件 + 本指令為準。
> 2. `investigator_templates` 的屬性總點數約束需要從 21 改為 18。
> 3. 天賦卡都是簽名卡，在 MOD-01 卡片設計器中以 `slot: 'talent'` + `is_signature: true` 建立。
> 4. 八陣營全滿需要 96 天賦點（8 × 12），約 8 個戰役的投資量。
> 5. I/T 都對應智力、N/F 都對應意志 — 這是刻意設計。
