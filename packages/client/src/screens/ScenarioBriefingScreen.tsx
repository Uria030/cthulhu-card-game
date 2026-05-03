import { useNavigate } from 'react-router-dom';
import './ScenarioBriefingScreen.css';

/**
 * 劇情提要 — 出發板與戰鬥板之間的橋接畫面
 *
 * 顯示關卡的前置劇情敘事,讓玩家進入戰鬥前先建立氛圍。
 * 文字現階段寫死(三地點測試關卡 G1 教學),未來可從 scenario.preamble 動態注入。
 *
 * 流程:出發板選關 → 本畫面 → 「進入關卡」→ 戰鬥板
 */

const TEST_SCENARIO_BRIEFING = {
  title: '三地點測試關卡',
  subtitle: 'G1 教學 · 預計 30 分鐘 · 推薦 1 人',
  paragraphs: [
    '雨水順著瓦片滑落,敲在牆上的鐵皮排水槽,發出空洞的聲響。',
    '剛才那封信仍在你口袋裡——「請於今晚到鎮南那條鵝卵石街,找到那家舊書店。我們需要你的眼睛。」',
    '你不認識寄信人。地址沒有店名,只有街角的描述。但你還是來了——你向來如此。',
    '街口的煤氣燈在霧氣裡昏黃地亮著。三條路在你眼前展開:那條陰冷無人的小巷、街尾那扇半掩的書店門、還有遠處被濃霧吞沒的後門。',
    '你深吸一口氣,把領子拉高。今晚要弄清楚,到底是誰——或什麼——在等你。',
  ],
  meta: '結算:通過 / 失敗 · 不產生戰役旗標 · 可重玩',
};

export function ScenarioBriefingScreen() {
  const navigate = useNavigate();

  return (
    <div className="brief-root">
      <div className="brief-backdrop" aria-hidden />
      <div className="brief-paper">
        <header className="brief-header">
          <div className="brief-eyebrow">前置劇情</div>
          <h1 className="brief-title">{TEST_SCENARIO_BRIEFING.title}</h1>
          <p className="brief-subtitle">{TEST_SCENARIO_BRIEFING.subtitle}</p>
        </header>

        <hr className="brief-divider" />

        <div className="brief-narrative">
          {TEST_SCENARIO_BRIEFING.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <hr className="brief-divider" />

        <div className="brief-meta">{TEST_SCENARIO_BRIEFING.meta}</div>

        <footer className="brief-footer">
          <button className="brief-back" onClick={() => navigate('/departure')}>
            ← 返回出發板
          </button>
          <button className="brief-enter" onClick={() => navigate('/scenario/test')}>
            進入關卡 →
          </button>
        </footer>
      </div>
    </div>
  );
}
