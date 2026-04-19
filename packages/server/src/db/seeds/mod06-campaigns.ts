// MOD-06 示範戰役種子：印斯茅斯陰影
// 第 1–2 章完整內容；第 3–10 章骨架（供設計師繼續填寫）

export const innsmouthCampaignSeed = {
  campaign: {
    code: 'innsmouth_shadow',
    name_zh: '印斯茅斯陰影',
    name_en: 'The Shadow Over Innsmouth',
    theme: '印斯茅斯、深潛者、克蘇魯眷族',
    cover_narrative:
      '你收到一封舊識的信，來自麻州海岸的一個小鎮——印斯茅斯。信紙上有海水的鹹味，字跡顫抖：「求你，來這裡找我。那些人……不是人。他們的眼睛……」\n\n舊識署名的下方，有一行被墨水劃掉的字，但你仍能辨認出：「深潛者」。\n\n火車站的列車員提醒你，印斯茅斯這種地方，去了就未必能回來。你摸了摸口袋裡的手槍，只剩六發子彈。\n\n迷霧已經從海上爬了上來。你要走進去嗎？',
    difficulty_tier: 'standard',
    initial_chaos_bag: {
      number_markers: { '+1': 1, '0': 2, '-1': 2, '-2': 2, '-3': 0, '-4': 0 },
      scenario_markers: {
        skull: { count: 2, effect: 'blood_sacrifice', value: -1 },
        cultist: { count: 1, effect: 'follower_response', value: -2 },
        tablet: { count: 1, effect: 'forbidden_knowledge', value: -2 },
        elder_thing: { count: 1, effect: 'otherworldly_seep', value: -3 },
      },
      mythos_markers: {
        clue: { count: 1, value: -1 },
        headline: { count: 1, value: -1 },
        monster: { count: 1, value: -2 },
        doom: { count: 1, value: -3 },
        gate: { count: 0, value: -3 },
      },
      extreme_markers: { tentacle: 1, elder_sign: 1 },
      dynamic_markers: { bless: 0, curse: 0 },
    },
  },

  chapter_1_full: {
    chapter_number: 1,
    chapter_code: 'ch1',
    name_zh: '抵達印斯茅斯',
    name_en: 'Arrival at Innsmouth',
    narrative_intro:
      '巴士在泥濘的路上顛簸了兩個小時。司機告訴你，這是今天唯一一班進鎮的車，也是明天唯一一班出鎮的車。巴士站是一間塗漆剝落的小屋，鎮上的空氣帶著魚腥味與你無法形容的甜膩。\n\n街上的人們遠遠盯著你，他們的脖子有奇怪的皮褶。一個雜貨店老闆壓低聲音說：「Gilman House Hotel，今晚別住那裡。」但他沒說要住哪裡，也沒說為什麼。\n\n你有三件事可做：找旅館、打聽那封信、或者，趁天還沒黑，先去警察局。',
    narrative_choices: [
      {
        id: 'choice_1',
        text_zh: '立刻去找旅館安頓',
        text_en: 'Find lodging immediately',
        effect: { set_flags: [{ flag_code: 'choice.ch1_went_to_hotel', value: true }] },
      },
      {
        id: 'choice_2',
        text_zh: '先向路人打聽舊識的下落',
        text_en: 'Ask locals about your contact',
        effect: { set_flags: [{ flag_code: 'choice.ch1_asked_locals', value: true }] },
      },
      {
        id: 'choice_3',
        text_zh: '直奔警察局報告',
        text_en: 'Go straight to the police station',
        effect: { set_flags: [{ flag_code: 'choice.ch1_went_to_police', value: true }] },
      },
    ],
    design_status: 'published',
  },

  chapter_1_outcomes: [
    {
      outcome_code: 'A',
      condition_expression: {
        type: 'and',
        conditions: [
          { type: 'flag_set', flag_code: 'npc.ch1_contact_alive' },
          { type: 'agenda_progress_gte', value: 1 },
        ],
      },
      narrative_text:
        '你找到了舊識。他的手在顫抖，眼神望向窗外的海。「他們今晚就要來了。」他塞給你一把鑰匙：「這個鎮的真相藏在 Marsh 家族的地下室。你必須——」話還沒說完，窗外傳來一陣腥臭的風。',
      next_chapter_version: 'ch2_contact_alive',
      flag_sets: [
        { flag_code: 'npc.ch1_contact_alive', value: true },
        { flag_code: 'item.ch1_marsh_key', value: true },
      ],
      chaos_bag_changes: [],
      rewards: { xp: 2, talent_point: 1 },
    },
    {
      outcome_code: 'B',
      condition_expression: {
        type: 'and',
        conditions: [
          { type: 'flag_set', flag_code: 'npc.ch1_contact_alive' },
          { type: 'agenda_progress_gte', value: 2 },
        ],
      },
      narrative_text:
        '你在警方的耳語與舊識的線索之間周旋了一整夜。天亮時，他仍活著，但顯然受到重創。你得到了部分的情報，卻也付出了時間的代價——有人在背後看著你們。',
      next_chapter_version: 'ch2_contact_alive',
      flag_sets: [
        { flag_code: 'npc.ch1_contact_alive', value: true },
        { flag_code: 'hidden.ch1_cult_alerted', value: true },
      ],
      chaos_bag_changes: [{ op: 'add', marker: 'cultist', count: 1 }],
      rewards: { xp: 1 },
    },
    {
      outcome_code: 'C',
      condition_expression: { type: 'agenda_progress_gte', value: 3 },
      narrative_text:
        '你在 Gilman House Hotel 的一樓大廳找到了他——只剩下半個身體。牆上用他自己的血寫著四個字：「他們來了。」你必須盡快離開這個房間，因為外面的走廊，已經有濕漉漉的腳步聲。',
      next_chapter_version: 'ch2_contact_dead',
      flag_sets: [{ flag_code: 'npc.ch1_contact_dead', value: true }],
      chaos_bag_changes: [
        { op: 'add', marker: 'skull', count: 1 },
        { op: 'add', marker: 'elder_thing', count: 1 },
      ],
      rewards: { xp: 1 },
    },
  ],

  chapter_1_flags: [
    { flag_code: 'choice.ch1_went_to_hotel', category: 'choice', description_zh: '調查員選擇先找旅館安頓', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'choice.ch1_asked_locals', category: 'choice', description_zh: '調查員選擇先向路人打聽', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'choice.ch1_went_to_police', category: 'choice', description_zh: '調查員選擇直奔警察局', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'npc.ch1_contact_alive', category: 'npc', description_zh: '舊識 Robert Olmstead 在第一章結束時仍存活', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'npc.ch1_contact_dead', category: 'npc', description_zh: '舊識 Robert Olmstead 在第一章結束時死亡', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'item.ch1_marsh_key', category: 'item', description_zh: '取得 Marsh 家族地下室鑰匙', visibility: 'visible', chapter_code: 'ch1' },
    { flag_code: 'hidden.ch1_cult_alerted', category: 'hidden', description_zh: '邪教徒察覺調查員抵達，提升敵人階段強度', visibility: 'hidden', chapter_code: 'ch1' },
  ],

  chapter_1_interludes: [
    {
      event_code: 'ch1_prologue_arrival',
      name_zh: '深夜的敲門聲',
      name_en: 'Knocking at Midnight',
      insertion_point: 'prologue',
      trigger_condition: null,
      operations: [
        {
          type: 'trigger_test',
          params: {
            attribute: 'perception',
            dc: 4,
            on_success: {
              rewards: { xp: 1 },
              set_flags: [{ flag_code: 'hidden.ch1_cult_alerted', value: false }],
            },
            on_fail: {
              penalty: { san_damage: 1 },
              set_flags: [{ flag_code: 'hidden.ch1_cult_alerted', value: true }],
            },
          },
        },
      ],
      narrative_text_zh:
        '凌晨三點，有人在敲你的房門。不是禮貌性的敲門，是急促的、指節摳門板的那種。門縫下滲進來一道微弱的光——走廊的燈被關掉了。\n\n你聽見自己的呼吸聲，也聽見門外有第二個人的呼吸聲。\n\n你屏住氣，試著從貓眼看出去。',
      narrative_text_en:
        "At 3 AM, someone is knocking at your door. Not a polite knock — urgent, knuckles scraping wood. A faint light bleeds under the door; the hallway lamp has been turned off.\n\nYou hear your own breath, and another's just beyond the door.\n\nYou hold yours, and lean toward the peephole.",
      choices: [],
    },
  ],

  chapter_2_full: {
    chapter_number: 2,
    chapter_code: 'ch2',
    name_zh: 'Marsh 家族的秘密',
    name_en: 'Secrets of the Marsh Family',
    narrative_intro:
      'Marsh 宅第比你想像的還要深。走廊的油畫上，每一代 Marsh 家主的面容都比上一代更為異樣——寬扁的嘴、後縮的下巴、凸起的眼球。\n\n那把舊識留給你的鑰匙，指向地窖最深處一扇沒有任何標示的鐵門。門的另一側，傳來低沉的誦經聲，以及海水沖刷岩壁的節奏。\n\n你有幾個選擇：直接推門進去、先在宅中尋找更多線索，或者，退回去找人幫忙。',
    narrative_choices: [
      {
        id: 'choice_1',
        text_zh: '直接推開鐵門',
        text_en: 'Push the iron door open',
        effect: { set_flags: [{ flag_code: 'choice.ch2_entered_basement', value: true }] },
      },
      {
        id: 'choice_2',
        text_zh: '先搜尋宅邸的其他樓層',
        text_en: 'Search the rest of the manor first',
        effect: { set_flags: [{ flag_code: 'choice.ch2_searched_manor', value: true }] },
      },
      {
        id: 'choice_3',
        text_zh: '退出宅邸，尋找盟友',
        text_en: 'Retreat and seek allies',
        effect: { set_flags: [{ flag_code: 'choice.ch2_sought_help', value: true }] },
      },
    ],
    design_status: 'published',
  },

  chapter_2_outcomes: [
    {
      outcome_code: 'A',
      condition_expression: {
        type: 'and',
        conditions: [
          { type: 'flag_set', flag_code: 'item.ch2_tome_obtained' },
          { type: 'act_progress_gte', value: 3 },
        ],
      },
      narrative_text:
        '你帶著封面浸透海水的 Marsh 家族族譜離開地窖。書頁間夾著的一枚古幣，在你掌心發出不該屬於這個世紀的冷意。儀式還沒開始，你還有時間。',
      next_chapter_version: 'ch3_standard',
      flag_sets: [{ flag_code: 'item.ch2_tome_obtained', value: true }],
      chaos_bag_changes: [{ op: 'add', marker: 'tablet', count: 1 }],
      rewards: { xp: 2 },
    },
    {
      outcome_code: 'B',
      condition_expression: { type: 'agenda_progress_gte', value: 2 },
      narrative_text:
        '儀式已經開始。你只能帶著破碎的線索逃出宅邸，背後傳來低沉的吟唱。你知道，下次遇上 Marsh 家族時，對方將以更可怕的姿態出現。',
      next_chapter_version: 'ch3_standard',
      flag_sets: [],
      chaos_bag_changes: [{ op: 'add', marker: 'skull', count: 1 }],
      rewards: { xp: 1 },
    },
    {
      outcome_code: 'C',
      condition_expression: { type: 'agenda_progress_gte', value: 4 },
      narrative_text:
        '你沒有逃出去。地窖的門在身後鎖上，冰冷的海水從石縫滲進來。你最後記得的，是一雙不屬於人類的手，輕輕蓋上你的眼睛。',
      next_chapter_version: 'ch3_standard',
      flag_sets: [{ flag_code: 'outcome.ch2_captured', value: true }],
      chaos_bag_changes: [
        { op: 'add', marker: 'elder_thing', count: 1 },
        { op: 'add', marker: 'cultist', count: 1 },
      ],
      rewards: {},
    },
  ],

  chapter_2_flags: [
    { flag_code: 'choice.ch2_entered_basement', category: 'choice', description_zh: '調查員選擇直接推開 Marsh 地窖鐵門', visibility: 'visible', chapter_code: 'ch2' },
    { flag_code: 'choice.ch2_searched_manor', category: 'choice', description_zh: '調查員選擇先搜尋 Marsh 宅邸', visibility: 'visible', chapter_code: 'ch2' },
    { flag_code: 'choice.ch2_sought_help', category: 'choice', description_zh: '調查員選擇退出並尋找盟友', visibility: 'visible', chapter_code: 'ch2' },
    { flag_code: 'item.ch2_tome_obtained', category: 'item', description_zh: '取得 Marsh 家族族譜', visibility: 'visible', chapter_code: 'ch2' },
    { flag_code: 'outcome.ch2_captured', category: 'outcome', description_zh: '調查員在第二章被深潛者擄走', visibility: 'visible', chapter_code: 'ch2' },
  ],

  chapters_skeleton: [
    { chapter_number: 3, chapter_code: 'ch3', name_zh: '地底深處' },
    { chapter_number: 4, chapter_code: 'ch4', name_zh: '深潛者的召喚' },
    { chapter_number: 5, chapter_code: 'ch5', name_zh: '海岸岩壁' },
    { chapter_number: 6, chapter_code: 'ch6', name_zh: '水下神殿' },
    { chapter_number: 7, chapter_code: 'ch7', name_zh: 'Dagon 的祭壇' },
    { chapter_number: 8, chapter_code: 'ch8', name_zh: "Y'ha-nthlei 的邊緣" },
    { chapter_number: 9, chapter_code: 'ch9', name_zh: '血脈的抉擇' },
    { chapter_number: 10, chapter_code: 'ch10', name_zh: '終焉之潮' },
  ],
};
