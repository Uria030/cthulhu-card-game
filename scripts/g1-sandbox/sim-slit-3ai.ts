/**
 * 全程模擬:裂嘴女的傳說 × 三位 AI 調查員(headless,鏡射戰鬥板回合流程)
 * 小隊:鐵證偵探(玩家席,由同引擎中性設定代駕)+ 伊萊亞斯 + 薇絲珀 + 馬庫斯
 * 流程:調查員階段(4 席輪動)→ 幕/議程推進(含轉場/頭目)→ 附著 upkeep →
 *       城主選卡執行 → 恐懼掃描 → 怪物啟動 → 結局判定;上限 30 回合
 * 用法:cd packages/client && npx tsx ../../scripts/g1-sandbox/sim-slit-3ai.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGameFromBootstrap,
  materializeAIInvestigator,
  profileForTemplate,
  initInvestigatorAIState,
  runInvestigatorAITurn,
  enumerateCandidates,
  deriveObjective,
  initKeeperState,
  defaultKeeperProfile,
  snapshotSituation,
  selectKeeperActivations,
  selectKeeperLegendaryEncounter,
  executeMythosCard,
  normaliseEncounterTriggerConfig,
  drawAndAutoResolveEncounter,
  ENCOUNTER_DECK_RESHUFFLED_NARRATIVE,
  runAttachmentUpkeep,
  activateMonsters,
  runFearChecks,
  progressTick,
  evaluateOutcome,
  commandTick,
  cumulativeDoom,
  formatCommandTrace,
  assignRoles,
  objectiveForAssignment,
  computeDeckBlueprint,
  AI_INVESTIGATOR_ROSTER,
  autoComposeParty,
  runTurnEndUpkeep,
  syncDownedState,
  runDeathSave,
  isDowned,
  isStanding,
  allInvestigatorsDead,
} from '@cthulhu/shared';
import type {
  StageBootstrap,
  InvestigatorState,
  InvestigatorAIProfile,
  InvestigatorAIState,
  MythosCardData,
  ActCardData,
  AgendaCardData,
  OutcomeData,
  ScenarioState,
  EncounterCardData,
} from '@cthulhu/shared';

const BASE = process.env.G1_API_BASE ?? 'https://server-production-fc4f.up.railway.app';
const DEFAULT_STAGE = '9ad171b3-c439-4049-b673-b929f91366ce';
const PLAYER_TPL = '70de5729-d553-4667-b6d6-25265d56b9c8'; // 鐵證偵探
const DEFAULT_TEAM = [PLAYER_TPL, 'elias_crane', 'vesper_grey', 'marcus_wainwright'];

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

const STAGE = argValue('--stage') ?? process.env.SIM_STAGE ?? DEFAULT_STAGE;
const TEAM_SPECS = (argValue('--team') ?? process.env.SIM_TEAM ?? DEFAULT_TEAM.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CACHE_DIR = argValue('--cache-dir') ?? process.env.SIM_CACHE_DIR ?? '';
const JSON_OUTPUT = hasArg('--json') || process.env.SIM_JSON === '1';
const AUTO_PLAYER = argValue('--auto-player') ?? process.env.SIM_AUTO_PLAYER ?? '';
const PARTY_SEED = Number(argValue('--party-seed') ?? process.env.SIM_PARTY_SEED ?? 0);
const AUTO_LIST = argValue('--auto-list') ?? process.env.SIM_AUTO_LIST ?? '';
const SELF_TEST_RESHUFFLE = hasArg('--self-test-encounter-reshuffle');

const seedInput = Number(argValue('--seed') ?? process.env.SIM_SEED ?? 20260612);
let rngSeed = seedInput;
const rng = () => {
  rngSeed = (rngSeed * 1103515245 + 12345) % 2147483648;
  return rngSeed / 2147483648;
};

function runEncounterReshuffleSelfTest(): void {
  const sourceDeck = Array.from({ length: 8 }, (_, i) => ({
    id: `sim-encounter-${i + 1}`,
    name_zh: `遭遇測試${i + 1}`,
    options: [],
  })) as EncounterCardData[];
  const cfg = normaliseEncounterTriggerConfig({ draw_on_turn_end: true });
  const values = [0.91, 0.14, 0.65, 0.29, 0.81, 0.03, 0.44, 0.52, 0.36];
  let i = 0;
  const selfRng = () => values[i++ % values.length];
  let deck = [...sourceDeck];
  let reshuffles = 0;
  const drawn: string[] = [];

  for (let drawIndex = 0; drawIndex < 9; drawIndex += 1) {
    const r = drawAndAutoResolveEncounter(
      deck,
      cfg,
      { path: 'turn_end' },
      { investigatorId: `sim-self-test-${drawIndex}` } as InvestigatorState,
      {} as ScenarioState,
      {},
      selfRng,
      sourceDeck,
    );
    if (!r.triggered || !r.card) throw new Error(`reshuffle self-test draw ${drawIndex + 1} did not draw`);
    if (r.reshuffled) reshuffles += 1;
    drawn.push(r.card.id);
    deck = r.remaining;
  }

  if (reshuffles !== 1) throw new Error(`reshuffle self-test expected 1 reshuffle, got ${reshuffles}`);
  if (deck.length !== 7) throw new Error(`reshuffle self-test expected remaining=7, got ${deck.length}`);
  console.log(`SIM_SELF_TEST encounter-reshuffle PASS draws=${drawn.join(',')} remaining=${deck.length} reshuffles=${reshuffles}`);
}

async function fetchBootstrap(invId: string): Promise<StageBootstrap> {
  const cacheFile = CACHE_DIR ? path.join(CACHE_DIR, `${STAGE}__${invId}.json`) : '';
  if (cacheFile && fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as StageBootstrap;
  }
  const url = `${BASE}/api/play/stages/${STAGE}/bootstrap?investigator=${encodeURIComponent(invId)}&crossTest=true`;
  const r = await fetch(url);
  const j = (await r.json()) as { success: boolean; data: StageBootstrap; error?: string };
  if (!r.ok || !j.success) throw new Error(`bootstrap ${invId} → ${r.status} ${j.error ?? ''}`);
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(j.data, null, 2));
  }
  return j.data;
}

async function fetchInvestigatorList(): Promise<NonNullable<StageBootstrap['investigator']>[]> {
  if (AUTO_LIST) {
    const raw = fs.readFileSync(AUTO_LIST, 'utf8');
    return JSON.parse(raw) as NonNullable<StageBootstrap['investigator']>[];
  }
  const url = `${BASE}/api/play/investigators?includeDraft=true`;
  const r = await fetch(url);
  const j = (await r.json()) as { success: boolean; data: NonNullable<StageBootstrap['investigator']>[]; error?: string };
  if (!r.ok || !j.success) throw new Error(`investigator list ${r.status} ${j.error ?? ''}`);
  return j.data;
}

async function resolveTeamTemplateIds(): Promise<string[]> {
  if (!AUTO_PLAYER) return TEAM_SPECS.map(resolveTeamSpec);
  const playerId = resolveTeamSpec(AUTO_PLAYER);
  const list = await fetchInvestigatorList();
  const player = list.find((inv) => inv.id === playerId || inv.code === AUTO_PLAYER || inv.mbti_code === AUTO_PLAYER);
  if (!player) throw new Error(`--auto-player not found: ${AUTO_PLAYER}`);
  const party = autoComposeParty(player, list, PARTY_SEED);
  const team = [player.id, ...party.members.map((inv) => inv.id)];
  if (team.length !== 4) throw new Error(`auto party needs 4 seats, got ${team.length}`);
  console.log(`[E13 auto-party] player=${player.code ?? player.id} seed=${PARTY_SEED} ai=${party.members.map((m) => m.code ?? m.id).join(',')}`);
  if (party.relaxed) console.log(`[E13 auto-party] relaxed=${party.reasons.join(',')}`);
  return team;
}

function lookupsFrom(b: StageBootstrap) {
  const locationStats: Record<string, { shroud?: number }> = {};
  const locNames: Record<string, string> = {};
  for (const loc of b.locations) {
    locationStats[loc.code] = { shroud: Number(loc.shroud ?? 10) };
    locNames[loc.code] = loc.name_zh;
  }
  const enemyStats: Record<string, any> = {};
  for (const mv of b.monsters as any[]) {
    enemyStats[String(mv.code)] = {
      name_zh: mv.name_zh, dc: Number(mv.dc ?? 10), damage_physical: Number(mv.damage_physical ?? 1),
      damage_horror: Number(mv.damage_horror ?? 0), fear_value: Number(mv.fear_value ?? 1),
      fear_radius: Number(mv.fear_radius ?? 1), fear_type: String(mv.fear_type ?? 'first_sight'),
      tier: Number(mv.tier ?? 1), attacks_per_round: Number(mv.attacks_per_round ?? 1),
      movement_speed: Number(mv.movement_speed ?? 1), ai_preference: String(mv.ai_preference ?? 'nearest'),
      move_pool: Array.isArray(mv.move_pool) ? mv.move_pool : [], hp_base: Number(mv.hp_base ?? 1),
      hp_per_player: Number(mv.hp_per_player ?? 0), family_code: mv.family_code,
      keywords: Array.isArray(mv.keywords) ? mv.keywords : [],
      move_pattern: String(mv.move_pattern ?? 'weighted'),
      behavior_script: mv.behavior_script ?? null,
      spell_defense: Number(mv.spell_defense ?? 0),
    };
  }
  const chaosMarkerEffects: Record<string, string> = {};
  for (const [sym, spec] of Object.entries((b.stage as any).chaos_bag?.scenario_markers ?? {})) {
    chaosMarkerEffects[sym] = String((spec as any)?.effect ?? '');
  }
  const attackCards: Record<string, any> = {};
  for (const mac of b.monster_attack_cards as any[]) {
    attackCards[String(mac.code)] = {
      code: mac.code, name_zh: mac.name_zh, defense_attribute: String(mac.defense_attribute ?? 'reflex'),
      dc_override: mac.dc_override == null ? null : Number(mac.dc_override),
      damage_physical: Number(mac.damage_physical ?? 0), damage_horror: Number(mac.damage_horror ?? 0),
    };
  }
  return { locationStats, locNames, enemyStats, attackCards, chaosMarkerEffects };
}

function cardLookupFrom(built: ReturnType<typeof buildGameFromBootstrap>) {
  const cardLookup: Record<string, any> = {};
  for (const [iid, info] of Object.entries(built.cardIndex)) {
    const d = (info as any).data;
    cardLookup[iid] = {
      commit_icons: d.commit_icons ?? {}, name_zh: (info as any).name_zh, card_type: (info as any).card_type,
      cost: (info as any).cost, combat_style: d.combat_style ?? null,
      attribute_modifiers: d.attribute_modifiers ?? {}, subtypes: d.subtypes ?? [],
      ammo: d.ammo ?? null, uses: d.uses ?? null,
      consume_enabled: Boolean(d.consume_enabled), consume_effect: d.consume_effect ?? null,
      effects: Array.isArray(d.effects) ? d.effects : [],
    };
  }
  return cardLookup;
}

interface Member {
  label: string;
  profile: InvestigatorAIProfile;
  inv: InvestigatorState;
  templateId: string;
  templateCode: string;
  factionCode: string | null;
  aiState: InvestigatorAIState;
  acted: Record<string, number>;
  /** 卡片層級稽核:打出的卡/武器揮擊/投入加值/引擎不支援的效果碼 */
  cardsPlayed: string[];
  weaponSwings: string[];
  spellCasts?: number;
  commitCount: number;
  unsupported: Set<string>;
  /** Uria 六項檢查數據:線索/造成傷害/賺取資源(不含起始)/抽卡(不含起手)/承受傷害/承受恐懼 */
  cluesGained: number;
  damageDealt: number;
  resourcesEarned: number;
  cardsDrawn: number;
  hpTaken: number;
  sanTaken: number;
  downedCount: number;
  /** P2 指派對齊率(驗證計畫丙):主動產出型行動 vs 被指派子目標 */
  assignedKind?: string;
  aligned: number;
  judged: number;
}

function resolveTeamSpec(spec: string): string {
  return AI_INVESTIGATOR_ROSTER.find((p) => p.rosterCode === spec)?.templateId ?? spec;
}

function makeMember(
  profile: InvestigatorAIProfile,
  built: ReturnType<typeof buildGameFromBootstrap>,
  source: StageBootstrap['investigator'],
): Member {
  return {
    label: profile.name_zh,
    profile,
    inv: materializeAIInvestigator(built.investigator, profile),
    templateId: profile.templateId,
    templateCode: profile.templateCode,
    factionCode: source?.faction_code ? String(source.faction_code) : null,
    aiState: initInvestigatorAIState(),
    acted: {},
    cardsPlayed: [],
    weaponSwings: [],
    commitCount: 0,
    unsupported: new Set(),
    cluesGained: 0,
    damageDealt: 0,
    resourcesEarned: 0,
    cardsDrawn: 0,
    hpTaken: 0,
    sanTaken: 0,
    downedCount: 0,
    aligned: 0,
    judged: 0,
  };
}

async function main() {
  if (SELF_TEST_RESHUFFLE) {
    runEncounterReshuffleSelfTest();
    return;
  }

  // ── 開局 ──
  const teamTemplateIds = await resolveTeamTemplateIds();
  if (teamTemplateIds.length !== 4) {
    throw new Error(`--team 必須剛好 4 位調查員,目前 ${teamTemplateIds.length}: ${TEAM_SPECS.join(',')}`);
  }
  const teamSize = teamTemplateIds.length;
  const baseB = await fetchBootstrap(teamTemplateIds[0]);
  const L = lookupsFrom(baseB);
  const baseBuilt = buildGameFromBootstrap(baseB, { cardInstancePrefix: 'p0_', rng, playerCount: teamSize });
  let cardLookup = cardLookupFrom(baseBuilt);
  const stylePools: Record<string, any[]> = {};
  const addPools = (b: StageBootstrap) => {
    for (const sc of b.combat_style_pools ?? []) {
      const pool = (stylePools[sc.style_code] = stylePools[sc.style_code] ?? []);
      if (!pool.some((x) => x.code === sc.code)) pool.push(sc);
    }
  };
  addPools(baseB);

  const baseProfile = profileForTemplate(baseB.investigator!, baseBuilt.investigator.combatStyle);
  const members: Member[] = [makeMember(baseProfile, baseBuilt, baseB.investigator)];

  for (const [i, templateId] of teamTemplateIds.slice(1).entries()) {
    const b = await fetchBootstrap(templateId);
    const built = buildGameFromBootstrap(b, { cardInstancePrefix: `ai${i + 1}_`, rng, playerCount: teamSize });
    cardLookup = { ...cardLookup, ...cardLookupFrom(built) };
    addPools(b);
    const profile = profileForTemplate(b.investigator!, built.investigator.combatStyle);
    members.push(makeMember(profile, built, b.investigator));
  }

  let scenario = baseBuilt.scenario;
  let flags: Record<string, unknown> = {};
  let keeperState = initKeeperState(defaultKeeperProfile(baseB.keeper_settings, members.length));
  const keeperProfile = defaultKeeperProfile(baseB.keeper_settings, members.length);
  const mythos = (baseB.mythos_cards ?? []) as unknown as MythosCardData[];
  const encounterSourceDeck = (baseB.encounter_cards ?? []) as unknown as EncounterCardData[];
  let encounterDeck = [...encounterSourceDeck];
  const encounterConfig = normaliseEncounterTriggerConfig((baseB.stage as any).encounter_trigger_config);
  const actData = (baseB.stage.act_cards ?? []) as unknown as ActCardData[];
  const agendaData = (baseB.stage.agenda_cards ?? []) as unknown as AgendaCardData[];
  const outcomes = (baseB.chapter?.outcomes ?? []) as unknown as OutcomeData[];
  const bossCode = 'G1_deep_one_slit_mouth';

  console.log(`══ ${baseB.stage.name_zh} ══ 小隊:${members.map((m) => m.label).join('、')}(${teamSize} 人,線索按人數縮放)`);
  console.log(`   出生點:${L.locNames[scenario.locations.find(l => l.locationDefinitionId === members[0].inv.currentLocationId)?.locationDefinitionId ?? '']}` +
    ` | 幕目標:${JSON.stringify((actData[0] as any)?.front_advance_condition)} | 議程門檻:${(agendaData[0] as any)?.front_doom_threshold}`);

  // §3.5 牌組戰術藍圖:開局解析(對 boss DC)
  {
    const bossDc = Number(L.enemyStats[bossCode]?.dc ?? 12);
    for (const m of members) {
      const bp = computeDeckBlueprint(m.inv, cardLookup, stylePools, bossDc);
      console.log(`   🧭 ${m.label} 藍圖:${bp.description}`);
    }
  }

  const keeperUsage: Record<string, number> = {};
  let mythosLog = 0;
  let legendaryDispatchLog = 0;
  let investigatorTurnEndEncounterLog = 0;
  let encounterDeckReshuffles = 0;
  let outcome: OutcomeData | null = null;
  let victoryFlag = false;

  const noteEncounterReshuffle = (reshuffled: boolean | undefined) => {
    if (!reshuffled) return;
    encounterDeckReshuffles += 1;
    console.log(`   [遭遇牌堆] ${ENCOUNTER_DECK_RESHUFFLED_NARRATIVE}`);
  };

  // 進度推進(鏡射 client applyProgress)
  const applyProgress = (): boolean => {
    const tick = progressTick(scenario, flags, actData, agendaData, L.enemyStats, teamSize);
    for (const eff of tick.effects) {
      const p = eff.params as any;
      if (eff.type === 'act_advanced') console.log(`   📜 幕推進:${p.name}`);
      if (eff.type === 'agenda_advanced') console.log(`   🕯 議程翻面:${p.name}`);
      if (eff.type === 'enemy_spawned') console.log(`   🌊 ${p.enemy} 出現在 ${L.locNames[p.location] ?? p.location}!`);
      if (eff.type === 'penalty_applied') console.log(`   ⚠ 議程後果:${p.narrative ?? p.penalty}`);
    }
    scenario = tick.scenario;
    flags = tick.flags;
    if (tick.switchScenario != null) {
      const built2 = buildGameFromBootstrap(baseB, { scenarioOrder: tick.switchScenario, rng, playerCount: teamSize });
      const sceneLocs = new Set(built2.scenario.locations.map((l) => l.locationDefinitionId));
      scenario = {
        ...built2.scenario,
        agendaProgress: scenario.agendaProgress,
        objectiveProgress: scenario.objectiveProgress,
        actIndex: scenario.actIndex,
        agendaIndex: scenario.agendaIndex,
        turnNumber: scenario.turnNumber,
        phase: scenario.phase,
        globalMoveCostBonus: scenario.globalMoveCostBonus,
        enemies: scenario.enemies.filter((e) => sceneLocs.has(e.locationId)),
        keeperAttachments: scenario.keeperAttachments,
      };
      for (const m of members) {
        m.inv = { ...m.inv, currentLocationId: built2.investigator.currentLocationId, engagedWith: [] };
      }
      console.log(`   🌧 ──── 場景轉換(scenario ${tick.switchScenario})────`);
    }
    if (tick.victory || tick.defeat) {
      outcome = evaluateOutcome(outcomes, flags);
      victoryFlag = !!tick.victory;
      return true;
    }
    return false;
  };

  // 承受傷害/恐懼:每回合邊界累計 HP/SAN 下降(checkpoint 在回合頂 + 迴圈後各一次)
  const prevHp: Record<string, number> = {};
  const prevSan: Record<string, number> = {};
  for (const m of members) { prevHp[m.label] = m.inv.hp; prevSan[m.label] = m.inv.san; }
  const checkpoint = () => {
    for (const m of members) {
      m.hpTaken += Math.max(0, prevHp[m.label] - m.inv.hp);
      m.sanTaken += Math.max(0, prevSan[m.label] - m.inv.san);
      prevHp[m.label] = m.inv.hp;
      prevSan[m.label] = m.inv.san;
    }
  };

  turnLoop: for (let t = 1; t <= 30; t += 1) {
    checkpoint();
    scenario = { ...scenario, turnNumber: t };
    {
      const bE = scenario.enemies.find((e) => e.enemyDefinitionId === bossCode && e.hp > 0);
      const nLoc = (id?: string) => (id ? (L.locNames[id] ?? id).slice(0, 4) : '?');
      console.log(`   📍 boss@${bE ? nLoc(bE.locationId) + '(HP' + bE.hp + ')' : '無'} 怪${scenario.enemies.filter((e) => e.hp > 0).length} | ` +
        members.map((m) => `${m.label.slice(0, 2)}@${nLoc(m.inv.currentLocationId ?? '')}${m.inv.engagedWith.length ? '⚔' : ''}`).join(' '));
    }
    console.log(`\n── T${t} ──`);

    // ⚑ 指揮層軌跡 + P2 指派(驗證計畫乙/丙)
    const cmdCtxFor = () => {
      const party: Record<string, InvestigatorState> = {};
      for (const m of members) party[m.inv.investigatorId] = m.inv;
      const cum = cumulativeDoom(scenario, agendaData);
      const observedDoomRate = t > 1 ? cum / (t - 1) : null; // 城主推進速率 = 累積毀滅 ÷ 已過回合(動態觀測,不寫死)
      return {
        scenario, investigators: party, actCards: actData, agendaCards: agendaData,
        enemyData: L.enemyStats, locationStats: L.locationStats, cardLookup, stylePools,
        playerCount: teamSize, observedDoomRate,
      };
    };
    {
      const cmdCtx = cmdCtxFor();
      const trace = commandTick(cmdCtx);
      console.log(formatCommandTrace(trace));
      const roles = assignRoles(trace, cmdCtx);
      const nameOf = (id: string) => members.find((m) => m.inv.investigatorId === id)?.label.slice(0, 3) ?? id;
      console.log(`   🎯 指派:${roles.map((r) => `${nameOf(r.investigatorId)}→${r.kind}${r.role === 'prepare' ? '(組陣)' : ''}`).join(' ')}`);
    }

    // ① 調查員階段(4 席輪動;瀕死者做瀕死檢定,死者沉默)
    for (const m of members) {
      if (m.inv.dead || m.inv.permanentlyDead) continue;
      if (isDowned(m.inv)) {
        const save = runDeathSave(m.inv, rng);
        m.inv = save.investigator;
        for (const eff of save.effects) {
          const p = eff.params as any;
          if (eff.type === 'death_save') console.log(`   🎲 ${m.label} 瀕死檢定 d20=${p.roll} → ${p.outcome}(成 ${p.successes}/3 敗 ${p.failures}/3)`);
          if (eff.type === 'death_save_stand') console.log(`   ✊ ${m.label} 站起來了`);
          if (eff.type === 'investigator_died') console.log(`   💀 ${m.label} 死亡(創傷上限 -1)`);
        }
        continue; // 站起也要等下回合行動
      }
      m.inv = { ...m.inv, actionPoints: 3 };
      const allies: Record<string, InvestigatorState> = {};
      for (const o of members) if (o !== m) allies[o.inv.investigatorId] = o.inv;
      // P2 指揮層接管目標:每席行動前重算(局勢可能已變),用「指派的子目標」當這席的 objective
      const cmdCtx = cmdCtxFor();
      const trace = commandTick(cmdCtx);
      const roles = assignRoles(trace, cmdCtx);
      const myRole = roles.find((r) => r.investigatorId === m.inv.investigatorId);
      const curActCond = [...actData].sort((a, b) => a.card_order - b.card_order)[scenario.actIndex ?? 0]?.front_advance_condition;
      const objective = objectiveForAssignment(myRole, trace.chain) ?? deriveObjective(curActCond, members.length, L.enemyStats);
      const aiCtx = { scenario, investigator: m.inv, allies, turnNumber: t, locationStats: L.locationStats, enemyStats: L.enemyStats, cardLookup, stylePools, chaosMarkerEffects: L.chaosMarkerEffects, actCards: actData, objective, urgency: trace.urgency, rng };
      if (myRole) { m.assignedKind = myRole.kind; }
      const bossHere = scenario.enemies.find((e) => e.hp > 0 && e.enemyDefinitionId === bossCode && e.locationId === m.inv.currentLocationId);
      if (bossHere && t >= 7) {
        const cands = enumerateCandidates(aiCtx, m.profile, m.aiState).sort((a, b) => b.score - a.score).slice(0, 5);
        console.log(`   🔬 ${m.label}@boss act=${scenario.actIndex} obj=${JSON.stringify(aiCtx.objective)} bossDef=${bossHere.enemyDefinitionId}: ${cands.map((c) => c.actionType + (c.payload.enemyInstanceId ? '→敵' : '') + '(' + c.score.toFixed(1) + ')').join(' ')}`);
      }
      const r = runInvestigatorAITurn(aiCtx, m.profile, m.aiState);
      m.inv = r.investigator; scenario = r.scenario; m.aiState = r.aiState;
      // 穩定救援改動到的隊友寫回
      for (const [allyId, allyState] of Object.entries(r.updatedAllies)) {
        const target = members.find((o) => o.inv.investigatorId === allyId);
        if (target) target.inv = allyState;
      }
      const accepted = r.steps.filter((s) => s.outcome === 'accepted');
      for (const s of accepted) m.acted[s.actionType] = (m.acted[s.actionType] ?? 0) + 1;
      // 指派對齊率(丙):只評「主動產出型」行動(investigate/attack/execute_card_action/use_shared_action)
      for (const s of accepted) {
        const productive = s.actionType === 'investigate' || s.actionType === 'attack' || s.actionType === 'execute_card_action' || s.actionType === 'use_shared_action';
        if (!productive || !m.assignedKind) continue;
        m.judged += 1;
        const fit = (m.assignedKind === 'clues' && s.actionType === 'investigate')
          || (m.assignedKind === 'kill' && (s.actionType === 'attack' || s.actionType === 'execute_card_action' || s.actionType === 'use_shared_action'));
        if (fit) m.aligned += 1;
      }
      // 卡片層級稽核
      for (const eff of accepted.flatMap((s) => s.effects)) {
        const p = eff.params as any;
        if (eff.type === 'play_card') m.cardsPlayed.push(String(p.name ?? '?'));
        if (eff.type === 'style_card_drawn') m.weaponSwings.push(String(p.name ?? '?'));
        if (eff.type === 'spell_cast') m.spellCasts = (m.spellCasts ?? 0) + 1;
        if (eff.type === 'commit_cards') m.commitCount += Number((p.cardInstanceIds ?? []).length);
        if (eff.type === 'effect_unsupported') for (const c of p.codes ?? []) m.unsupported.add(String(c));
        // Uria 六項:本人行動產生的效果
        if (eff.type === 'gain_clue') m.cluesGained += Number(p.amount ?? 1);
        if (eff.type === 'attack_hit') m.damageDealt += Number(p.damage ?? 0);
        if (eff.type === 'gain_resource') m.resourcesEarned += Number(p.amount ?? 1);
        if (eff.type === 'draw_card') m.cardsDrawn += 1;
      }
      // 施法軌證據(混沌袋 + 副作用)
      for (const eff of accepted.flatMap((s) => s.effects)) {
        const p = eff.params as any;
        if (eff.type === 'chaos_token_drawn') console.log(`   🌑 ${m.label} 抽混沌袋:${p.sequence}`);
        if (eff.type === 'spell_strain') console.log(`   ${(p.delta < 0 ? '😖' : '✨')} ${m.label} 施法${p.delta < 0 ? '反噬' : '受護'}(SAN ${p.delta > 0 ? '+' : ''}${p.delta})`);
        if (eff.type === 'chaos_scene_effect') console.log(`   🕳 ${m.label} 觸發場景效果:${p.code}`);
        if (eff.type === 'shared_action_used') console.log(`   📜 ${m.label} ${p.name ?? p.code}:棄${p.amount}線索→${p.damage}傷`);
      }
      const kills = accepted.flatMap((s) => s.effects).filter((e) => e.type === 'enemy_defeated').length;
      const detail = accepted.map((s) => {
        if (s.actionType === 'play_card') {
          const pc = s.effects.find((e) => e.type === 'play_card');
          return `play_card【${(pc?.params as any)?.name ?? '?'}】`;
        }
        if (s.actionType === 'execute_card_action') {
          const sw = s.effects.find((e) => e.type === 'style_card_drawn');
          return `武器攻擊(${(sw?.params as any)?.name ?? '卡行動'})`;
        }
        if (s.actionType === 'use_shared_action') {
          const sa = s.effects.find((e) => e.type === 'shared_action_used');
          return `use_shared_action【${(sa?.params as any)?.name ?? (s.payload as any).code ?? '?'}】`;
        }
        return s.actionType;
      });
      console.log(`   ${m.label}:${detail.join('→') || '按兵不動'}${kills ? ` ☠×${kills}` : ''}`);
      if (applyProgress()) break turnLoop;

      const legendary = encounterSourceDeck.length > 0 && encounterConfig.keeper_mythos !== false
        ? selectKeeperLegendaryEncounter(mythos, members.map((x) => x.inv), keeperState, rng)
        : { card: null, target: null, state: keeperState };
      if (legendary.card && legendary.target) {
        keeperState = legendary.state;
        const target = members.find((x) => x.inv.investigatorId === legendary.target?.investigatorId);
        if (target) {
          const enc = drawAndAutoResolveEncounter(
            encounterDeck,
            encounterConfig,
            { path: 'keeper_mythos', mythosCardCategory: 'encounter' },
            target.inv,
            scenario,
            L.enemyStats,
            rng,
            encounterSourceDeck,
          );
          if (enc.triggered && enc.card) {
            encounterDeck = enc.remaining;
            scenario = enc.scenario;
            target.inv = syncDownedState(enc.investigator).investigator;
            legendaryDispatchLog += 1;
            keeperUsage[legendary.card.name_zh] = (keeperUsage[legendary.card.name_zh] ?? 0) + 1;
            noteEncounterReshuffle(enc.reshuffled);
            console.log(`   [城主傳奇派發]【${legendary.card.name_zh}】→ ${target.label} 抽「${enc.card.name_zh}」`);
            if (applyProgress()) break turnLoop;
          }
        }
      }
    }

    // ② 附著 upkeep(v0:只結算玩家席)
    if ((scenario.keeperAttachments ?? []).length > 0) {
      const up = runAttachmentUpkeep(scenario.keeperAttachments ?? [], members[0].inv, rng);
      members[0].inv = up.investigator;
      scenario = { ...scenario, keeperAttachments: up.attachments };
    }

    // ③ 城主
    const actCond0 = (actData[0] as any)?.front_advance_condition;
    const situation = snapshotSituation(scenario, members[0].inv,
      actCond0?.type === 'clue_threshold' ? Number(actCond0.count ?? 0) * teamSize : null,
      Number(L.enemyStats[bossCode]?.hp_base ?? 0) || null);
    const sel = selectKeeperActivations(mythos, situation, keeperState, keeperProfile, rng);
    keeperState = sel.state;
    for (const card of sel.activations) {
      keeperUsage[card.name_zh] = (keeperUsage[card.name_zh] ?? 0) + 1;
      const keeperParty: Record<string, InvestigatorState> = {};
      for (const m of members) keeperParty[m.inv.investigatorId] = m.inv;
      const exec = executeMythosCard(card, scenario, members[0].inv, L.enemyStats, rng, teamSize, keeperParty);
      scenario = exec.scenario; members[0].inv = exec.investigator;
      for (const [id, after] of Object.entries(exec.updatedInvestigators ?? {})) {
        const target = members.find((o) => o.inv.investigatorId === id);
        if (target) target.inv = after;
      }
      if (exec.attachments.length > 0) {
        const newIds = new Set(exec.attachments.map((a) => a.cardId));
        scenario = { ...scenario, keeperAttachments: [...(scenario.keeperAttachments ?? []).filter((a) => !newIds.has(a.cardId)), ...exec.attachments] };
      }
      console.log(`   [城主]【${card.name_zh}】` + exec.effects.filter((e) => e.type === 'enemy_spawned').map((e) => ` → ${(e.params as any).enemy} 現身 ${L.locNames[(e.params as any).location] ?? ''}`).join(''));
      mythosLog += 1;
      if (exec.effects.some((e) => e.type === 'enemy_spawned')) {
        for (const m of members) {
          if (m.inv.hp <= 0 || m.inv.san <= 0) continue;
          const fear = runFearChecks(m.inv, scenario, L.enemyStats, rng);
          m.inv = fear.investigator;
        }
      }
    }

    // ④ 怪物啟動(站著的都是獵物)
    const partyMap: Record<string, InvestigatorState> = {};
    for (const m of members) if (isStanding(m.inv)) partyMap[m.inv.investigatorId] = m.inv;
    const act = activateMonsters(scenario, partyMap, L.enemyStats, L.attackCards, rng);
    scenario = act.scenario;
    for (const m of members) {
      const after = act.investigators[m.inv.investigatorId];
      if (after) {
        const dHp = m.inv.hp - after.hp; const dSan = m.inv.san - after.san;
        if (dHp > 0 || dSan > 0) console.log(`   👹 ${m.label} 受襲(HP-${dHp}/SAN-${dSan})`);
        m.inv = after;
      }
      // 倒地同步(§9:歸零 → 瀕死)
      const sync = syncDownedState(m.inv);
      m.inv = sync.investigator;
      if (sync.effects.some((e) => e.type === 'investigator_downed')) {
        m.downedCount += 1;
        console.log(`   🩸 ${m.label} 瀕死倒地`);
      }
    }

    // ⑤ 全滅判定(§9:全員死亡才終局;倒地者還有瀕死檢定機會)
    const partyAll: Record<string, InvestigatorState> = {};
    for (const m of members) partyAll[m.inv.investigatorId] = m.inv;
    if (allInvestigatorsDead(partyAll)) {
      console.log('   💀 全員陣亡 — 終局');
      outcome = evaluateOutcome(outcomes, flags);
      break;
    }
    if (applyProgress()) break;

    // ⑤.5 E20 回合結束遭遇:城主階段全部結束後、補給前,站立者依席位各抽 1 張。
    for (const m of members) {
      if (!isStanding(m.inv)) continue;
      const enc = drawAndAutoResolveEncounter(
        encounterDeck,
        encounterConfig,
        { path: 'turn_end', locationId: m.inv.currentLocationId },
        m.inv,
        scenario,
        L.enemyStats,
        rng,
        encounterSourceDeck,
      );
      if (!enc.triggered || !enc.card) continue;
      encounterDeck = enc.remaining;
      scenario = enc.scenario;
      m.inv = syncDownedState(enc.investigator).investigator;
      investigatorTurnEndEncounterLog += 1;
      noteEncounterReshuffle(enc.reshuffled);
      console.log(`   [回合結束遭遇] ${m.label} 抽「${enc.card.name_zh}」`);
      if (applyProgress()) break turnLoop;
    }

    // ⑥ 回合結束階段(ch2 §2.4):抽 1 卡 + 1 資源 + 手牌上限
    for (const m of members) {
      const up = runTurnEndUpkeep(m.inv);
      m.inv = up.investigator;
      for (const eff of up.effects) {
        const p = eff.params as any;
        if (eff.type === 'gain_resource' || eff.type === 'upkeep_income') m.resourcesEarned += Number(p.amount ?? 1);
        if (eff.type === 'draw_card' || eff.type === 'upkeep_draw') m.cardsDrawn += 1;
      }
    }
  }

  checkpoint(); // 收尾:最後一回合的承受量

  // ── 結果報告 ──
  console.log('\n══ 結果 ══');
  console.log(`結局:${victoryFlag ? '✓ 勝利' : '✗ 敗北/未分'}${outcome ? `(${(outcome as any).outcome_code}:${String((outcome as any).narrative_text ?? '').slice(0, 60)}…)` : '(30 回合上限,無結局判定)'}`);
  console.log(`回合數:${scenario.turnNumber} | 線索:${scenario.objectiveProgress} | 毀滅:${scenario.agendaProgress} | 場上存活怪:${scenario.enemies.filter((e) => e.hp > 0).length}`);
  for (const m of members) {
    const a = Object.entries(m.acted).map(([k, v]) => `${k}×${v}`).join(' ');
    console.log(`  ${m.label}:HP ${m.inv.hp}/${m.inv.hpMax} SAN ${m.inv.san}/${m.inv.sanMax} | ${a || '(無行動)'}`);
    console.log(`     打出:${m.cardsPlayed.join('、') || '(無)'} | 武器揮擊:${m.weaponSwings.length} | 施法:${m.spellCasts ?? 0} | 投牌加值:${m.commitCount} 張` +
      `${m.unsupported.size ? ` | ⚠ 引擎不支援效果:${[...m.unsupported].join(',')}` : ''}`);
    console.log(`     殘局:手牌 ${m.inv.hand.length} 場上 ${m.inv.assetsInPlay.map((id) => cardLookup[id]?.name_zh ?? id).join('、') || '(空)'} 資源 ${m.inv.resources}`);
  }

  console.log('\n══ 六項檢查數據(關卡結束統計;承受量為每回合邊界淨損,場內被救/回血會略低估)══');
  for (const m of members) {
    console.log(`  ${m.label}: 線索 ${m.cluesGained} | 造成傷害 ${m.damageDealt} | 賺取資源 ${m.resourcesEarned} | 抽卡 ${m.cardsDrawn} | 承受傷害 ${m.hpTaken} | 承受恐懼 ${m.sanTaken}`);
  }
  console.log('\n══ 指派對齊率(驗證計畫丙:主動產出行動 vs 指派子目標)══');
  for (const m of members) {
    const pct = m.judged > 0 ? ((m.aligned / m.judged) * 100).toFixed(0) + '%' : '—';
    console.log(`  ${m.label}: ${m.aligned}/${m.judged}(${pct})最後指派:${m.assignedKind ?? '無'}`);
  }
  console.log(`城主啟用:${Object.entries(keeperUsage).map(([k, v]) => `${k}×${v}`).join(' ')}(共 ${mythosLog} 次)`);
  console.log(`遭遇入口:回合結束遭遇 ${investigatorTurnEndEncounterLog} 次 | 城主傳奇派發 ${legendaryDispatchLog} 次 | 剩餘遭遇池 ${encounterDeck.length} 張 | 重洗 ${encounterDeckReshuffles} 次`);

  const boss = scenario.enemies.find((e) => e.enemyDefinitionId === bossCode);
  const result = {
    schema: 'ug-cross-test-result-v1',
    stageId: STAGE,
    seed: seedInput,
    team: members.map((m) => ({
      templateId: m.templateId,
      templateCode: m.templateCode,
      factionCode: m.factionCode,
      name_zh: m.label,
      title_zh: m.profile.title_zh,
    })),
    victory: victoryFlag,
    outcomeCode: outcome ? String((outcome as any).outcome_code ?? '') : null,
    turnNumber: scenario.turnNumber,
    doom: scenario.agendaProgress,
    objectiveProgress: scenario.objectiveProgress,
    bossHp: boss?.hp ?? null,
    aliveEnemies: scenario.enemies.filter((e) => e.hp > 0).length,
    keeperActivations: keeperUsage,
    investigatorTurnEndEncounters: investigatorTurnEndEncounterLog,
    legendaryDispatches: legendaryDispatchLog,
    encounterDeckRemaining: encounterDeck.length,
    encounterDeckReshuffles,
    members: members.map((m) => ({
      templateId: m.templateId,
      templateCode: m.templateCode,
      factionCode: m.factionCode,
      name_zh: m.label,
      title_zh: m.profile.title_zh,
      clues: m.cluesGained,
      damage: m.damageDealt,
      resources: m.resourcesEarned,
      cardsDrawn: m.cardsDrawn,
      hpTaken: m.hpTaken,
      sanTaken: m.sanTaken,
      downed: m.downedCount,
      alignmentNumerator: m.aligned,
      alignmentDenominator: m.judged,
      blueprintFormedTurn: null,
      unsupportedEffects: [...m.unsupported],
      finalHp: m.inv.hp,
      finalSan: m.inv.san,
    })),
  };
  if (JSON_OUTPUT) console.log(`SIM_RESULT_JSON ${JSON.stringify(result)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
