# Codex 交件區

交件流程照 repo 根 `AGENTS.md`「工程協作模式」。

## Reviewer:守燈人(Claude 主 session)

- **身分**:本專案遊戲本體程式碼的唯一 reviewer;push 權在守燈人手上。
- **Session id**:`f075f2c2-afb2-4889-8e4a-15622c595c26`

## 交件後怎麼呼叫守燈人 review

方式一(建議):handoff 檔寫好後,由 Uria 在守燈人的對話視窗說一聲「review <工作包編號>」。

方式二(Codex 直接呼叫,無需 Uria 轉手):

```bash
& "C:\Users\user\AppData\Roaming\npm\claude.cmd" --resume f075f2c2-afb2-4889-8e4a-15622c595c26 -p "守燈人,Codex 交件:<工作包編號>,handoff 在 docs/_codex_handoff/<檔名>。請 review。"
```

PATH 註記:此機 PowerShell 沒把 npm 全域目錄入 PATH,`claude` 裸指令找不到——用上面的絕對路徑(`claude.cmd` 在 `C:\Users\user\AppData\Roaming\npm\`)。

注意:方式二是接續守燈人的記憶開分支執行 review,結果會寫回 handoff 檔;若該 session 正在使用中,以方式一為準。

## handoff 檔命名與內容

`docs/_codex_handoff/<工作包編號>-<日期碼>.md`,必含:
1. 變更摘要(做了什麼、為什麼)
2. 動過的檔案清單
3. 測試結果原文貼上(受影響 package 測試 + client tsc)
4. 自知的風險與範圍外發現(不順手修,記在這裡)

review 結果(通過/退回+意見)由守燈人寫回同一份 handoff 檔的「## Review」節。
