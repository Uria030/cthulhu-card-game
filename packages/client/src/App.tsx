import { ATTRIBUTES, GAME_RULES } from '@cthulhu/shared';

export function App() {
  return (
    <div style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>克蘇魯卡牌冒險</h1>
      <p>Cthulhu Card-Driven Cooperative Adventure</p>
      <hr />
      <h2>七大屬性</h2>
      <ul>
        {Object.values(ATTRIBUTES).map((attr) => (
          <li key={attr.id}>
            {attr.zh}（{attr.en}）— {attr.abbr}
          </li>
        ))}
      </ul>
      <p>骰子系統：{GAME_RULES.DICE}｜每回合行動數：{GAME_RULES.ACTIONS_PER_TURN}</p>
    </div>
  );
}
