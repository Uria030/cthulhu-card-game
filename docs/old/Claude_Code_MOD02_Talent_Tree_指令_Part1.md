# Claude Code 指令：天賦樹設計器 MOD-02（Part 1/3）
## Talent Tree Designer Instructions — Database & Seed Data

> **給 Claude Code：** 本文件是 MOD-02 天賦樹設計器的第一部分，定義資料庫結構與預設資料。
> 請依序完成：Part 1（本文件）→ Part 2（API + 頁面）→ Part 3（AI 生成 + 視覺化）。
>
> **設計器用途：** 管理八陣營各自的 12 級天賦樹結構，包含分支路線、
> 天賦節點效果、屬性提升分配、天賦卡綁定，以及陣營間的比較分析。
>
> **核心規則來源：** 《成長子系統設計 v0.1》（GDD05 產出）、
> 《規則書 v1.0 第四章》§1、《支柱一：陣營與構築》。
>
> **視覺原則：** 與 MOD-01 一致 — 暗黑哥德色彩系統（admin-shared.css）。

---

# 第一部分：資料庫結構

## 1.1 核心表結構概覽

```
talent_trees（8 棵樹的定義 — 每陣營一棵）
  │
  ├── talent_branches（每棵樹 3 條分支路線）
  │
  └── talent_nodes（12 級節點，每個節點綁定一條分支或共通主幹）
       │
       └── talent_node_effects（每個節點的具體效果列表）
```

## 1.2 talent_trees — 天賦樹定義（主表）

```sql
CREATE TABLE talent_trees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_code      VARCHAR(2) UNIQUE NOT NULL
                    CHECK (faction_code IN ('E', 'I', 'S', 'N', 'T', 'F', 'J', 'P')),
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  
  -- 陣營主屬性對應（GDD05 設計）
  primary_attribute VARCHAR(16) NOT NULL,
  secondary_attribute VARCHAR(16),
  
  -- 戰鬥熟練傾向
  combat_proficiency_primary   VARCHAR(64),
  combat_proficiency_secondary VARCHAR(64),
  
  -- 設計備註
  design_notes      TEXT,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'partial', 'complete')),
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 1.3 talent_branches — 分支路線定義

```sql
CREATE TABLE talent_branches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id           UUID NOT NULL REFERENCES talent_trees(id) ON DELETE CASCADE,
  branch_index      INTEGER NOT NULL CHECK (branch_index BETWEEN 1 AND 3),
  
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  
  -- 分支主題方向（用於 AI 生成時的上下文）
  theme_keywords    TEXT,
  
  -- 分支色彩（用於視覺化，十六進位色碼）
  color_hex         VARCHAR(7),
  
  design_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (tree_id, branch_index)
);
```

## 1.4 talent_nodes — 天賦節點定義

```sql
CREATE TABLE talent_nodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id           UUID NOT NULL REFERENCES talent_trees(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES talent_branches(id) ON DELETE SET NULL,
  
  -- 節點位置
  level             INTEGER NOT NULL CHECK (level BETWEEN 1 AND 12),
  is_trunk          BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- 節點類型
  node_type         VARCHAR(32) NOT NULL DEFAULT 'passive'
                    CHECK (node_type IN (
                      'passive',           -- 被動能力（檢定加值、傷害加成等）
                      'attribute_boost',   -- 屬性提升（+1 指定屬性）
                      'proficiency',       -- 專精解鎖（戰鬥專精槽位）
                      'talent_card',       -- 天賦卡解鎖（綁定簽名卡代碼）
                      'branch_choice',     -- 分支選擇點（3 級）
                      'milestone',         -- 質變能力（3/6 級的分支定義能力）
                      'ultimate'           -- 終極天賦（12 級）
                    )),
  
  -- 節點基本資訊
  name_zh           VARCHAR(64) NOT NULL,
  name_en           VARCHAR(64) NOT NULL,
  description_zh    TEXT,
  description_en    TEXT,
  
  -- 屬性提升（僅 node_type = 'attribute_boost' 時使用）
  boost_attribute   VARCHAR(16),
  boost_amount      INTEGER DEFAULT 1,
  
  -- 天賦卡綁定（僅 node_type = 'talent_card' 時使用）
  talent_card_code  VARCHAR(64),
  
  -- 前置需求（JSON 陣列，可以是其他節點的 ID 或等級條件）
  prerequisites     JSONB NOT NULL DEFAULT '[]',
  
  -- 天賦點花費
  talent_point_cost INTEGER NOT NULL DEFAULT 1,
  
  -- 排序與設計狀態
  sort_order        INTEGER NOT NULL DEFAULT 0,
  design_status     VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (design_status IN ('pending', 'draft', 'complete')),
  design_notes      TEXT,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_talent_nodes_tree ON talent_nodes(tree_id);
CREATE INDEX idx_talent_nodes_branch ON talent_nodes(branch_id);
CREATE INDEX idx_talent_nodes_level ON talent_nodes(tree_id, level);
```

## 1.5 talent_node_effects — 節點效果子表

```sql
CREATE TABLE talent_node_effects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id           UUID NOT NULL REFERENCES talent_nodes(id) ON DELETE CASCADE,
  
  -- 效果定義（沿用卡片效果語言的代碼體系）
  effect_code       VARCHAR(64) NOT NULL,
  effect_params     JSONB NOT NULL DEFAULT '{}',
  effect_desc_zh    TEXT NOT NULL,
  effect_desc_en    TEXT,
  
  -- 效果價值估算（用於平衡檢驗）
  effect_value      DECIMAL(5,1) DEFAULT 0,
  
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_talent_effects_node ON talent_node_effects(node_id);
```

---

# 第二部分：Seed Data

## 2.1 八棵天賦樹定義

> **注意：** 八陣營的主屬性對應來自 GDD05 設計規則：
> I/T 都對應智力、N/F 都對應意志。

```sql
INSERT INTO talent_trees (faction_code, name_zh, name_en, primary_attribute, secondary_attribute, combat_proficiency_primary, combat_proficiency_secondary, description_zh) VALUES
('E', '號令天賦樹', 'Herald Talent Tree', 'charisma', 'strength', 'military', 'brawl',
 '團隊增益、共享資源、NPC 互動、領導光環。號令者是隊伍的核心，透過指揮和激勵讓全隊更強。'),

('I', '深淵天賦樹', 'Abyss Talent Tree', 'intellect', 'willpower', 'arcane', 'assassin',
 '單獨加成、牌庫操控、自我增幅、專精強化。凝視深淵的學者，在孤獨中找到別人找不到的答案。'),

('S', '鐵證天賦樹', 'Witness Talent Tree', 'perception', 'strength', 'shooting', 'sidearm',
 '裝備加成、物理攻擊、消耗品效率、環境互動。鐵證如山的調查員，用物理手段解決問題。'),

('N', '天啟天賦樹', 'Oracle Talent Tree', 'willpower', 'intellect', 'arcane', 'engineer',
 '混沌袋操控、預見事件、法術強化、預知反應。被知識選中的先知，看見別人看不見的東西。'),

('T', '解析天賦樹', 'Cipher Talent Tree', 'intellect', 'perception', 'engineer', 'archery',
 '弱點揭露、敵人預測、檢定重擲、資源效率。冷靜的分析師，將混亂化為秩序。'),

('F', '聖燼天賦樹', 'Ember Talent Tree', 'willpower', 'charisma', 'brawl', 'military',
 '治療、替人承傷、犧牲換效果、信念計數器。燃燒自己照亮他人的守護者。'),

('J', '鐵壁天賦樹', 'Bastion Talent Tree', 'constitution', 'strength', 'military', 'sidearm',
 '傷害減免、回合佈局、牌組一致性、堅守強化。不動如山的堡壘，隊伍最後的防線。'),

('P', '流影天賦樹', 'Flux Talent Tree', 'agility', 'perception', 'assassin', 'archery',
 '反應行動、棄牌堆回收、隨機獎勵、逆境觸發。在混亂中起舞的幸運兒，越絕望越強大。');
```

## 2.2 每棵樹的三條分支路線

> **設計原則：** 每個陣營的三條分支代表該陣營內部的三種特化方向。
> 分支在第 3 級分歧，第 6 級核心能力上線，第 12 級終極天賦。
> 以下分支方向名稱是基於八陣營機制關鍵字的合理推演，
> 管理員可在設計器中自由修改。

```sql
-- E 號令：指揮官 / 外交官 / 戰場鼓舞者
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'E'), 1, '戰場指揮', 'Field Commander', '團隊增益、行動經濟、戰術佈署', '#C9A84C'),
((SELECT id FROM talent_trees WHERE faction_code = 'E'), 2, '外交斡旋', 'Diplomat', 'NPC 互動、資源共享、情報交換', '#D4B85C'),
((SELECT id FROM talent_trees WHERE faction_code = 'E'), 3, '激勵之聲', 'Inspiring Voice', '士氣增幅、恐懼抵抗、團隊回復', '#BF9A3C');

-- I 深淵：禁忌學者 / 陰影行者 / 自我超越者
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'I'), 1, '禁忌學識', 'Forbidden Scholar', '書籍研究、牌庫操控、知識解鎖', '#2A3F6F'),
((SELECT id FROM talent_trees WHERE faction_code = 'I'), 2, '陰影行者', 'Shadow Walker', '隱蔽、暗殺、單獨行動增益', '#1E2D5A'),
((SELECT id FROM talent_trees WHERE faction_code = 'I'), 3, '深淵凝視', 'Abyss Gazer', '自我增幅、代價換力量、SAN 燃燒', '#3A5090');

-- S 鐵證：火力專家 / 裝備大師 / 現場鑑識
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'S'), 1, '火力至上', 'Firepower', '射擊強化、彈藥效率、遠程制壓', '#8B5E3C'),
((SELECT id FROM talent_trees WHERE faction_code = 'S'), 2, '裝備大師', 'Equipment Master', '鍛造增幅、裝備耐久、多槽位', '#7A4E2C'),
((SELECT id FROM talent_trees WHERE faction_code = 'S'), 3, '現場鑑識', 'Field Forensics', '線索發現、環境互動、消耗品回收', '#9C6E4C');

-- N 天啟：星象術士 / 預言者 / 次元行者
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'N'), 1, '星象術士', 'Astromancer', '法術強化、混沌袋操控、元素精通', '#7B4EA3'),
((SELECT id FROM talent_trees WHERE faction_code = 'N'), 2, '預言者', 'Prophet', '預見事件、預知反應、議程操控', '#6B3E93'),
((SELECT id FROM talent_trees WHERE faction_code = 'N'), 3, '次元行者', 'Dimension Walker', '空間操控、傳送、次元門互動', '#8B5EB3');

-- T 解析：弱點分析師 / 資源工程師 / 戰術規劃師
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'T'), 1, '弱點分析', 'Weakness Analyst', '敵人弱點揭露、增傷標記、情報收集', '#4A7C9B'),
((SELECT id FROM talent_trees WHERE faction_code = 'T'), 2, '資源工程', 'Resource Engineer', '資源效率、經濟引擎、抽牌優化', '#3A6C8B'),
((SELECT id FROM talent_trees WHERE faction_code = 'T'), 3, '戰術規劃', 'Tactical Planner', '檢定重擲、機率操控、計畫執行', '#5A8CAB');

-- F 聖燼：治療師 / 守護者 / 殉道者
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'F'), 1, '神聖治療', 'Sacred Healer', 'HP/SAN 恢復、狀態清除、創傷修復', '#B84C4C'),
((SELECT id FROM talent_trees WHERE faction_code = 'F'), 2, '鋼鐵守護', 'Iron Guardian', '替人承傷、護盾生成、嘲諷強化', '#A83C3C'),
((SELECT id FROM talent_trees WHERE faction_code = 'F'), 3, '殉道之路', 'Martyr''s Path', '犧牲換效果、信念計數器、瀕死增幅', '#C85C5C');

-- J 鐵壁：不動堡壘 / 秩序之盾 / 戰線維持
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'J'), 1, '不動堡壘', 'Immovable Fortress', '傷害減免、護甲強化、反擊', '#6B6B6B'),
((SELECT id FROM talent_trees WHERE faction_code = 'J'), 2, '秩序之盾', 'Shield of Order', '回合佈局、牌組一致性、計畫行動', '#5B5B5B'),
((SELECT id FROM talent_trees WHERE faction_code = 'J'), 3, '戰線維持', 'Front Line', '嘲諷、交戰控制、區域封鎖', '#7B7B7B');

-- P 流影：機運之子 / 棄牌堆行者 / 逆境爆發
INSERT INTO talent_branches (tree_id, branch_index, name_zh, name_en, theme_keywords, color_hex) VALUES
((SELECT id FROM talent_trees WHERE faction_code = 'P'), 1, '機運之子', 'Fortune''s Child', '隨機獎勵、幸運觸發、混沌袋祝福', '#2D8B6F'),
((SELECT id FROM talent_trees WHERE faction_code = 'P'), 2, '棄牌堆行者', 'Discard Walker', '棄牌堆回收、循環引擎、資源再生', '#1D7B5F'),
((SELECT id FROM talent_trees WHERE faction_code = 'P'), 3, '逆境爆發', 'Adversity Surge', '低血量增幅、逆境觸發、反應行動強化', '#3D9B7F');
```

## 2.3 通用天賦樹節奏骨架（每棵樹 12 級）

> **設計原則：** 所有八棵天賦樹共享相同的「節奏骨架」，
> 但每個節點的具體效果由管理員或 AI 填入。以下骨架定義了
> 哪些等級是主幹（共通）、哪些是分支專屬、哪些有特殊節點類型。

以下 SQL 為**模板**，需要對八棵樹各執行一次（tree_id 替換為對應的 UUID）。
Claude Code 請用迴圈或函數自動為八棵樹生成。

```sql
-- 通用節奏模板（以 {TREE_ID} 代替實際 UUID）
-- Lv1-2：共通主幹（所有分支共享）
INSERT INTO talent_nodes (tree_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, 1, TRUE, 'passive',          '基礎本能',   'Basic Instinct',     '陣營的基礎被動能力，採用該陣營即獲得', 1, 1),
({TREE_ID}, 2, TRUE, 'attribute_boost',  '屬性覺醒 I', 'Attribute Awakening I', '第一次屬性提升（+1 陣營主屬性）', 1, 2);

-- Lv3：分支選擇點（三選一，選定後鎖定分支路線）
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 3, FALSE, 'branch_choice', '分支一：覺醒', 'Branch 1: Awakening', '選擇此分支路線，解鎖分支一的後續節點', 1, 3),
({TREE_ID}, {BRANCH_2_ID}, 3, FALSE, 'branch_choice', '分支二：覺醒', 'Branch 2: Awakening', '選擇此分支路線，解鎖分支二的後續節點', 1, 3),
({TREE_ID}, {BRANCH_3_ID}, 3, FALSE, 'branch_choice', '分支三：覺醒', 'Branch 3: Awakening', '選擇此分支路線，解鎖分支三的後續節點', 1, 3);

-- Lv4：分支被動
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 4, FALSE, 'passive', '分支一 Lv4', 'Branch 1 Lv4', '待設計', 1, 4),
({TREE_ID}, {BRANCH_2_ID}, 4, FALSE, 'passive', '分支二 Lv4', 'Branch 2 Lv4', '待設計', 1, 4),
({TREE_ID}, {BRANCH_3_ID}, 4, FALSE, 'passive', '分支三 Lv4', 'Branch 3 Lv4', '待設計', 1, 4);

-- Lv5：專精解鎖
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5),
({TREE_ID}, {BRANCH_2_ID}, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5),
({TREE_ID}, {BRANCH_3_ID}, 5, FALSE, 'proficiency', '專精解鎖 I', 'Specialization I', '解鎖一個戰鬥專精槽位', 1, 5);

-- Lv6：質變能力（分支核心能力上線）
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 6, FALSE, 'milestone', '分支一：核心', 'Branch 1: Core', '分支核心能力，打法產生實質差異', 2, 6),
({TREE_ID}, {BRANCH_2_ID}, 6, FALSE, 'milestone', '分支二：核心', 'Branch 2: Core', '分支核心能力，打法產生實質差異', 2, 6),
({TREE_ID}, {BRANCH_3_ID}, 6, FALSE, 'milestone', '分支三：核心', 'Branch 3: Core', '分支核心能力，打法產生實質差異', 2, 6);

-- Lv7：屬性提升 II
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7),
({TREE_ID}, {BRANCH_2_ID}, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7),
({TREE_ID}, {BRANCH_3_ID}, 7, FALSE, 'attribute_boost', '屬性覺醒 II', 'Attribute Awakening II', '第二次屬性提升', 1, 7);

-- Lv8：進階專精
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8),
({TREE_ID}, {BRANCH_2_ID}, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8),
({TREE_ID}, {BRANCH_3_ID}, 8, FALSE, 'proficiency', '進階專精', 'Advanced Specialization', '解鎖進階戰鬥專精或強化已有專精', 1, 8);

-- Lv9：天賦卡解鎖
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9),
({TREE_ID}, {BRANCH_2_ID}, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9),
({TREE_ID}, {BRANCH_3_ID}, 9, FALSE, 'talent_card', '天賦卡 I', 'Talent Card I', '解鎖分支專屬天賦簽名卡', 1, 9);

-- Lv10：屬性提升 III
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10),
({TREE_ID}, {BRANCH_2_ID}, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10),
({TREE_ID}, {BRANCH_3_ID}, 10, FALSE, 'attribute_boost', '屬性覺醒 III', 'Attribute Awakening III', '第三次屬性提升', 1, 10);

-- Lv11：高階被動 + 屬性提升 IV
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 11, FALSE, 'passive', '分支一 Lv11', 'Branch 1 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11),
({TREE_ID}, {BRANCH_2_ID}, 11, FALSE, 'passive', '分支二 Lv11', 'Branch 2 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11),
({TREE_ID}, {BRANCH_3_ID}, 11, FALSE, 'passive', '分支三 Lv11', 'Branch 3 Lv11', '高階被動能力 + 第四次屬性提升', 2, 11);

-- Lv12：終極天賦（超凡入聖）+ 屬性提升 V
INSERT INTO talent_nodes (tree_id, branch_id, level, is_trunk, node_type, name_zh, name_en, description_zh, talent_point_cost, sort_order) VALUES
({TREE_ID}, {BRANCH_1_ID}, 12, FALSE, 'ultimate', '終極天賦：分支一', 'Ultimate: Branch 1', '超凡入聖的終極能力，依分支不同而異', 3, 12),
({TREE_ID}, {BRANCH_2_ID}, 12, FALSE, 'ultimate', '終極天賦：分支二', 'Ultimate: Branch 2', '超凡入聖的終極能力，依分支不同而異', 3, 12),
({TREE_ID}, {BRANCH_3_ID}, 12, FALSE, 'ultimate', '終極天賦：分支三', 'Ultimate: Branch 3', '超凡入聖的終極能力，依分支不同而異', 3, 12);
```

> **Claude Code 實作注意：** 上面的 SQL 是模板，需要寫一個 seed 腳本，
> 對八棵樹各執行一次，自動替換 `{TREE_ID}` 和 `{BRANCH_N_ID}` 為實際 UUID。
> 每棵樹生成：2 個主幹節點 + 30 個分支節點（10 級 × 3 分支）= 32 個節點。
> 八棵樹共計：8 × 32 = 256 個節點。

## 2.4 屬性提升分配規則

> 根據 GDD05 設計：創角總點數 18 點（非 21 點），
> 差額 3 點透過天賦樹的 5 次屬性提升在冒險中補回。

| 屬性提升 | 等級 | 提升數量 | 選擇規則 |
|----------|------|----------|---------|
| 覺醒 I | Lv2 | +1 | 固定提升陣營主屬性 |
| 覺醒 II | Lv7 | +1 | 管理員指定（可選主屬性或副屬性） |
| 覺醒 III | Lv10 | +1 | 管理員指定（任意屬性） |
| 覺醒 IV | Lv11 | +1 | 管理員指定（任意屬性） |
| 覺醒 V | Lv12 | +1 | 管理員指定（任意屬性） |

> 5 次提升 × +1 = +5 點，加上創角 18 點 = 23 點潛力（超過原始 21 點上限 2 點），
> 代表天賦樹的成長讓角色超越起始極限。

## 2.5 節點類型統計（每條分支）

| 等級 | 節點類型 | 說明 |
|------|---------|------|
| 1 | `passive` | 主幹 — 基礎被動 |
| 2 | `attribute_boost` | 主幹 — 屬性提升 I |
| 3 | `branch_choice` | 分支選擇點 |
| 4 | `passive` | 分支被動 |
| 5 | `proficiency` | 專精解鎖 |
| 6 | `milestone` | 質變能力 |
| 7 | `attribute_boost` | 屬性提升 II |
| 8 | `proficiency` | 進階專精 |
| 9 | `talent_card` | 天賦卡解鎖 |
| 10 | `attribute_boost` | 屬性提升 III |
| 11 | `passive` | 高階被動 + 屬性提升 IV |
| 12 | `ultimate` | 終極天賦 + 屬性提升 V |

> 天賦點總花費：1+1+1+1+1+2+1+1+1+1+2+3 = **16 天賦點**（每棵樹點滿一條分支）

---

# 第三部分：參考常數

需要在 `admin-shared.js` 中新增（如果不存在）：

```javascript
// 天賦樹常數
const TALENT_TREE_RULES = {
  MAX_LEVEL: 12,
  BRANCHES_PER_TREE: 3,
  TREES_COUNT: 8,
  BRANCH_CHOICE_LEVEL: 3,
  MILESTONE_LEVELS: [3, 6],
  PROFICIENCY_LEVELS: [5, 8],
  ATTRIBUTE_BOOST_LEVELS: [2, 7, 10, 11, 12],
  TALENT_CARD_LEVEL: 9,
  ULTIMATE_LEVEL: 12,
  TOTAL_TALENT_POINTS_PER_BRANCH: 16,
  STARTING_ATTRIBUTE_POINTS: 18,
  ATTRIBUTE_BOOSTS_COUNT: 5,
};

// 節點類型定義
const NODE_TYPES = {
  passive:         { zh: '被動能力',   en: 'Passive',           color: '#C9A84C' },
  attribute_boost: { zh: '屬性提升',   en: 'Attribute Boost',   color: '#4A7C9B' },
  proficiency:     { zh: '專精解鎖',   en: 'Proficiency',       color: '#B84C4C' },
  talent_card:     { zh: '天賦卡解鎖', en: 'Talent Card',       color: '#7B4EA3' },
  branch_choice:   { zh: '分支選擇',   en: 'Branch Choice',     color: '#2D8B6F' },
  milestone:       { zh: '質變能力',   en: 'Milestone',         color: '#C9A84C' },
  ultimate:        { zh: '終極天賦',   en: 'Ultimate',          color: '#FFD700' },
};

// 八陣營主屬性對應
const FACTION_ATTRIBUTES = {
  E: { primary: 'charisma',     secondary: 'strength',   zh: '號令', en: 'Herald',  color: '#C9A84C' },
  I: { primary: 'intellect',    secondary: 'willpower',  zh: '深淵', en: 'Abyss',   color: '#3A5FA0' },
  S: { primary: 'perception',   secondary: 'strength',   zh: '鐵證', en: 'Witness', color: '#8B5E3C' },
  N: { primary: 'willpower',    secondary: 'intellect',  zh: '天啟', en: 'Oracle',  color: '#7B4EA3' },
  T: { primary: 'intellect',    secondary: 'perception', zh: '解析', en: 'Cipher',  color: '#4A7C9B' },
  F: { primary: 'willpower',    secondary: 'charisma',   zh: '聖燼', en: 'Ember',   color: '#B84C4C' },
  J: { primary: 'constitution', secondary: 'strength',   zh: '鐵壁', en: 'Bastion', color: '#6B6B6B' },
  P: { primary: 'agility',      secondary: 'perception', zh: '流影', en: 'Flux',    color: '#2D8B6F' },
};
```

---

# 附錄：相關文件

- 《成長子系統設計 v0.1》— 天賦樹 12 級結構、分支路線、八陣營概覽（GDD05 產出）
- 《規則書 v1.0 第一章》§2 支柱 5 — 成長子系統（天賦樹定位）
- 《規則書 v1.0 第四章》§1 — 五條成長路徑（天賦樹是路徑之一）
- 《規則書 v1.0 第六章》§15 — 待設計：天賦點獲取量與天賦樹結構
- 《支柱一：陣營與構築》— 八陣營機制關鍵字與戰鬥熟練傾向
- 《規則書 v1.0 第六章》§10 — 30 種戰鬥專精代碼表
- 《資料庫結構設計 v0.1》§3 — 調查員模組（skill_trees 預留）

> **注意事項：**
> 1. 資料庫 Schema v0.1 中的 `investigator_templates` 表的屬性總點數約束目前是 `= 21`，
>    需要改為 `= 18` 以配合 GDD05 的設計修正。
> 2. `investigator_templates` 表目前沒有天賦樹相關欄位，
>    需要新增 `talent_tree_progress JSONB` 欄位到 `investigator_states` 表。
