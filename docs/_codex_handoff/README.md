# Codex 交件區

本目錄是 E 系列 / 本體工作包的必過 Gate,不是備忘區。Codex 交件必須在這裡留下 handoff,並送守燈人 review;未完成 review 前,不得宣稱專案完成。

交件流程照 repo 根 `AGENTS.md`「工程協作 Gate」。

## Reviewer:守燈人(Claude 主 session)

- **身分**:本專案遊戲本體程式碼的唯一 reviewer;push 權在守燈人手上。
- **Session id**:`c3586396-14f0-425c-b548-c0ba5e8d5161`

## 交件後必須呼叫守燈人 review

方式一:handoff 檔寫好後,由 Uria 在守燈人的對話視窗說一聲「review <工作包編號>」。

方式二:Codex 直接呼叫,無需 Uria 轉手:

```bash
& "C:\Users\user\AppData\Roaming\npm\claude.cmd" --resume c3586396-14f0-425c-b548-c0ba5e8d5161 -p "守燈人,Codex 交件:<工作包編號>,handoff 在 docs/_codex_handoff/<檔名>。請 review。"
```

PATH 註記:此機 PowerShell 沒把 npm 全域目錄入 PATH,`claude` 裸指令找不到——用上面的絕對路徑(`claude.cmd` 在 `C:\Users\user\AppData\Roaming\npm\`)。

注意:方式二是接續守燈人的記憶開分支執行 review,結果會寫回 handoff 檔;**若該 session 正在使用中,resume 不可靠——改用方式三**。

方式三(**自動化首選**:開新 session 當守燈人代理,不依賴本尊 session 狀態):

```bash
& "C:\Users\user\AppData\Roaming\npm\claude.cmd" -p "你是守燈人代理,對 Codex 交件執行 review。讀 docs/_codex_handoff/README.md 的『代理 review checklist』與 AGENTS.md 工程協作模式,review 本機未推送的 commit(handoff 檔:docs/_codex_handoff/<檔名>)。結論寫回該 handoff 的 ## Review 節;PASS 才 git push origin main,否則不 push 並列修訂意見。" --permission-mode acceptEdits
```

方式四(**hub 管線,自動化正解**——走 GAS Hub 的現成審查請求機制,全程可視於 hub LINE UI):

```bash
node C:\gas\hub\.tools\hub-review.mjs --to claude --file <handoff 絕對路徑> --title "<工作包編號> review 請求" --wait-decision 900 --out <裁決結果檔>
```

- 前置:hub 在跑(`hub-daemon.ps1`;`node C:\gas\hub\.tools\hub-talk.mjs status` 確認 pty.claude running)。
- **handoff 檔開頭必須加一行**:「你是守燈人代理,照 `C:\Ug\cthulhu-card-game\docs\_codex_handoff\README.md` 的『代理 review checklist』執行,結論以 PASS/WARN/BLOCK 開頭回覆。」(hub 的 Claude PTY 記憶空間是 c:\gas,不帶本專案脈絡,brief 必須自足指路。)
- 裁決回流:hub-review 會等 PASS/WARN/BLOCK 並寫進 --out;PASS → 由守燈人代理(hub Claude)push;BLOCK/WARN → Codex 照意見修訂再送。
- 優先序:方式四(hub)> 方式三(headless 新 session)> 方式一(Uria 轉手,重大工作包建議仍走這條讓本尊審)。

## 代理 review checklist(方式三/方式四的代理照此執行)

1. `git log origin/main..HEAD` 確認 Codex 本機 commit;`git show --stat` 對 handoff 檔案清單一致。
2. diff 逐檔審:範圍不得超出工單;禁碰區(規則書 docs/v07*/凍結資料)零觸碰。
3. 複跑:受影響 package 測試 + `packages/client npx tsc --noEmit`(嚴格編 shared)。
4. 涉引擎:跑 `scripts/g1-sandbox/sim-slit-3ai.ts` 至少 1 種子確認不崩。
5. 歷史紅線:多人一致性(updatedAllies 管線)/計時器競態防護(不得在 setTimeout 閉包寫 state)/腳本冪等。
6. 結論寫回 handoff `## Review` 節(PASS/BLOCK+意見);PASS → push;任何不確定 → 不 push,標「留守燈人本尊複核」。

## Done 定義

- Codex 端 done:實作完成、測試完成、本機 commit、handoff 完成、review 已送出或已把可送審指令交給 Uria。
- 專案 done:守燈人 review PASS 並 push。
- 若 review 回 BLOCK/WARN,同一工作包回 Codex 修訂,補測試,更新同一 handoff,再送一次 review。
- prod smoke 若等待尚未部署的 server 修改,標記為部署順序問題並在部署後補跑;不要用 smoke 失敗偷改已凍結範圍。

## handoff 檔命名與內容

`docs/_codex_handoff/<工作包編號>-<日期碼>.md`,必含:
1. 變更摘要(做了什麼、為什麼)
2. 動過的檔案清單
3. 測試結果原文貼上(受影響 package 測試 + client tsc)
4. 自知的風險與範圍外發現(不順手修,記在這裡)

review 結果(通過/退回+意見)由守燈人寫回同一份 handoff 檔的「## Review」節。
