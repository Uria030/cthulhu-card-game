# Imagegen prompt set

執行方式：Codex built-in `image_gen`，以 `../A-study-v1.png` 作為每張候選的 edit target。

## 共同不變條款

- 只新增一名坐在指定既有椅子上的匿名 1920 年代調查員。
- 完整保留 1536×1024 構圖、四張椅子、桌面八入口物件、窗、檯燈、壁爐、牆框與鏡頭透視。
- 人影使用深褐與暖灰，禁純黑；衣褶、肩線與髮／帽輪廓保留中間調。
- 無可辨識臉孔、無手指細節、無現代服裝。
- 必須有可信的椅面接觸、局部接觸陰影與對應光源 rim light。
- 禁矩形補丁邊、貼圖接縫、發光圈、白邊光暈、額外人物、額外道具、文字與浮水印。

## 候選差異

- `seat-1A`：左側窗邊椅；無帽 archivist；微前傾；窗冷灰 rim + 檯燈暖 fill。
- `seat-1B`：左側窗邊椅；軟呢帽 watchman；直坐朝桌；窗冷灰 rim + 檯燈暖 fill。
- `seat-2C`：後方中央椅；寬帽沿 watchman；低頭看文件、帽沿完全遮臉；檯燈頂光。
- `seat-2D`：後方中央椅；短髮 healer；背向窗景、直坐；檯燈暖頂光 + 窗冷 rim。
- `seat-3A`：右側火爐椅；短髮 craftsperson；三分之四背向、微內傾；火光暖 rim。
- `seat-3B`：右側火爐椅；波浪髮 performer；側坐交腿；火光暖 rim + 檯燈微 fill。
- `seat-4A`：右下前景椅；fedora private investigator；背向、前傾看地圖；火光暖 rim + 檯燈頂光。
- `seat-4B`：右下前景椅；短髮 scholar；背向、直坐並留出地圖；火光與窗／檯燈分離光。
