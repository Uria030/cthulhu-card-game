# ART-CALIBRATION 座位前後景層級技術討論

> `HUB_DISCUSSION`：只收斂已核可八個人物位置的合成層級，不重開美術選型、不做 Review verdict。

- 提問：`Othriel @ Codex Desktop / UG`
- 上層紀錄：`ART-CALIBRATION-OVERLAYS-26071327.md`
- 前置 Gate：3A pilot 已由 Hammon `OVERALL_PASS`

## 已驗證事實

1. `1A/1B`、`2C/2D`、`3A/3B` 位於桌後；人物下部應受 shared foreground 桌面遮擋。
2. `4A/4B` 是近右前景，原 full-scene 候選中人物覆蓋桌面／地圖；若沿用 3A 的 `base -> person -> shared foreground`，4 席會被桌面錯誤切掉。
3. Uria 已裁定八張全數保留；不可用淘汰 4 席解決。
4. shared foreground 必須維持逐像素 derived from 同一 base 的既有 Gate。

## 建議

metadata 加：

```json
{ "seatLayer": "behind-foreground | front-of-foreground" }
```

整體固定合成順序：

```text
base
-> seats 1/2/3 person overlays
-> shared foreground
-> seat 4 person overlay
```

個別 QA composite 依 `seatLayer` 產生：後席用 `base -> person -> foreground`；前席用 `base -> foreground -> person`。

請 Hammon 與 Raviel 兩回合收斂：

1. 此 schema／順序是否 ACCEPT？
2. seat 4 的接觸陰影應歸 person 層或另作最小 mask？
3. 最小機械 Gate 如何證明後席沒有浮桌、前席沒有被桌切斷，且 foreground 仍完全源自 base？

## HUB 兩回合收斂結論

- Task：`20260719053410-art-calibration-seat-depth-layer-contrac-e98f40`
- 狀態：`discussion_done`
- 參與：Hammon（Claude）＋ Raviel（Codex）
- 結論：兩位沒有實質分歧，採用本提案並補強為 fail-closed 契約。

鎖定內容：

1. metadata 必填 `{ seatId, seatLayer }`；`seatLayer` 只允許 `behind-foreground`、`front-of-foreground`。缺值、拼錯、未知值一律 fail，不得 fallback。
2. `1A/1B/2C/2D/3A/3B = behind-foreground`；`4A/4B = front-of-foreground`。
3. 全局順序固定為 `base -> all behind persons -> shared foreground -> all front persons`，由 metadata 機械排序，不在 renderer 寫死 seat 4 特例。
4. 接觸陰影保留於 person alpha；只有抽取器無法保留時，才退到最小 derived-from-candidate mask。
5. QA 檔名帶 `seatLayer`，使審圖時可直接辨識採用的規則。
6. Gate 必須同時證明 shared foreground 逐像素來自 base、人物與 foreground overlap 大於 0、後席 overlap 最終像素等於 foreground/base、前席 overlap 最終像素等於 person composite，且 mismatch 必須為 0；overlap=0 不得自動 PASS。
7. 既有 `canvasExitEdges` 例外繼續有效，但只豁免指定畫布邊緣，不豁免其他 Gate。

此結論是撰寫拍的技術施工決策，不等同於完成後 Review。
