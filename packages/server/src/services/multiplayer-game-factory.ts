/**
 * MP-N2 authoritative game builder.
 *
 * The server obtains the same StageBootstrap rows used by the single-player
 * board, builds every seat here, and keeps the non-serialisable rule context
 * inside the room service. No browser may supply a state or a card lookup.
 */
import { createRequire } from 'node:module';
import type {
  CardDataLookup,
  EnemyDataLookup,
  EncounterCardData,
  EncounterTriggerConfig,
  InvestigatorAIProfile,
  MultiplayerRoomMember,
  StageBootstrap,
} from '@cthulhu/shared';
import type { AuthoritativeGameState } from './multiplayer-rooms.js';

const require = createRequire(import.meta.url);
const runtime = require('@cthulhu/shared') as typeof import('@cthulhu/shared');
const {
  AI_INVESTIGATOR_ROSTER,
  buildGameFromBootstrap,
  defaultKeeperProfile,
  mergeEncounterTriggerConfigs,
  materializeAIInvestigator,
  normaliseEncounterTriggerConfig,
} = runtime;

export interface MultiplayerBootstrapSource {
  templateId: string;
  bootstrap: StageBootstrap;
}

export function requiredAiTemplateIds(selectedTemplateIds: readonly string[], vacancyCount: number): string[] {
  const selected = new Set(selectedTemplateIds);
  return AI_INVESTIGATOR_ROSTER
    .filter((profile: InvestigatorAIProfile) => !selected.has(profile.templateId))
    .slice(0, Math.max(0, vacancyCount))
    .map((profile: InvestigatorAIProfile) => profile.templateId);
}

function cardLookupFrom(bootstraps: StageBootstrap[], builtStates: Array<ReturnType<typeof buildGameFromBootstrap>>): CardDataLookup {
  const lookup: CardDataLookup = {};
  for (const built of builtStates) {
    for (const [id, info] of Object.entries(built.cardIndex)) {
      lookup[id] = info.data as CardDataLookup[string];
    }
  }
  return lookup;
}

function enemyDataFrom(bootstrap: StageBootstrap): EnemyDataLookup {
  return Object.fromEntries(
    bootstrap.monsters.map((monster) => [String(monster.code), monster]),
  ) as EnemyDataLookup;
}

function locationStatsFrom(bootstrap: StageBootstrap): Record<string, { shroud?: number }> {
  return Object.fromEntries(
    bootstrap.locations.map((location) => [location.code, { shroud: Number(location.shroud ?? 10) }]),
  );
}

function stylePoolsFrom(bootstraps: StageBootstrap[]): Record<string, any[]> {
  const pools: Record<string, any[]> = {};
  for (const bootstrap of bootstraps) {
    for (const card of bootstrap.combat_style_pools ?? []) {
      const key = String(card.style_code ?? '');
      if (!key) continue;
      const target = (pools[key] = pools[key] ?? []);
      if (!target.some((existing) => existing.code === card.code)) target.push(card);
    }
  }
  return pools;
}

function chaosMarkerEffectsFrom(bootstrap: StageBootstrap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bootstrap.stage.chaos_bag?.scenario_markers ?? {}).map(([symbol, value]) => [
      symbol,
      String(value.effect ?? ''),
    ]),
  );
}

function attackCardsFrom(bootstrap: StageBootstrap): Record<string, any> {
  return Object.fromEntries(bootstrap.monster_attack_cards.map((card) => [String(card.code), card]));
}

/** Build a four-seat game: all ready humans plus E13 roster AI filling vacancies. */
export function buildAuthoritativeMultiplayerGame(input: {
  stageId: string;
  members: MultiplayerRoomMember[];
  bootstraps: MultiplayerBootstrapSource[];
}): AuthoritativeGameState {
  const bootstrapByTemplate = new Map(input.bootstraps.map((entry) => [entry.templateId, entry.bootstrap]));
  const humanSeats = input.members.map((member) => {
    const templateId = member.investigatorTemplateId;
    const saveId = member.saveId;
    const bootstrap = templateId ? bootstrapByTemplate.get(templateId) : null;
    if (!templateId || !saveId || !bootstrap?.investigator) throw new Error(`缺少真人席位開局包或存檔:${member.playerId}`);
    return { member, templateId, saveId, bootstrap };
  });
  if (humanSeats.length < 2) throw new Error('多人 v1 至少需要兩位真人席位。');

  const takenTemplateIds = new Set(humanSeats.map((seat) => seat.templateId));
  const aiProfiles = AI_INVESTIGATOR_ROSTER
    .filter((profile: InvestigatorAIProfile) => !takenTemplateIds.has(profile.templateId))
    .slice(0, Math.max(0, 4 - humanSeats.length));
  if (aiProfiles.length !== Math.max(0, 4 - humanSeats.length)) {
    throw new Error('AI 名冊不足以補滿多人 v1 四席。');
  }
  const aiSeats = aiProfiles.map((profile: InvestigatorAIProfile) => {
    const bootstrap = bootstrapByTemplate.get(profile.templateId);
    if (!bootstrap?.investigator) throw new Error(`缺少 AI 開局包:${profile.templateId}`);
    return { profile, bootstrap };
  });

  const allBootstraps = [...humanSeats.map((seat) => seat.bootstrap), ...aiSeats.map((seat) => seat.bootstrap)];
  const builtStates = allBootstraps.map((bootstrap, index) => buildGameFromBootstrap(bootstrap, {
    playerCount: 4,
    cardInstancePrefix: `mp${index}_`,
  }));
  const scenario = builtStates[0]?.scenario;
  if (!scenario) throw new Error('多人開局包無法建立場景。');

  const investigators: AuthoritativeGameState['investigators'] = {};
  const playerInvestigators: Record<string, string> = {};
  const playerSaveIds: Record<string, string> = {};
  const controllerByInvestigator: Record<string, 'human' | 'ai'> = {};
  const aiProfilesByInvestigator: Record<string, InvestigatorAIProfile> = {};

  for (const [index, seat] of humanSeats.entries()) {
    const built = builtStates[index];
    const investigator = { ...built.investigator, ownerPlayerId: seat.member.playerId };
    investigators[investigator.investigatorId] = investigator;
    playerInvestigators[seat.member.playerId] = investigator.investigatorId;
    playerSaveIds[seat.member.playerId] = seat.saveId;
    controllerByInvestigator[investigator.investigatorId] = 'human';
  }
  for (const [offset, seat] of aiSeats.entries()) {
    const built = builtStates[humanSeats.length + offset];
    const investigator = {
      ...materializeAIInvestigator(built.investigator, seat.profile),
      ownerPlayerId: `ai:${seat.profile.rosterCode}`,
    };
    investigators[investigator.investigatorId] = investigator;
    controllerByInvestigator[investigator.investigatorId] = 'ai';
    aiProfilesByInvestigator[investigator.investigatorId] = seat.profile;
  }

  const primary = allBootstraps[0];
  const stageEncounterConfig = normaliseEncounterTriggerConfig(
    (primary.stage as Record<string, unknown>).encounter_trigger_config,
  );
  const scenarioEncounterConfig = normaliseEncounterTriggerConfig(
    (primary.stage.scenarios[0] as Record<string, unknown> | undefined)?.encounter_trigger_config,
  );
  const encounterTriggerConfig: EncounterTriggerConfig = mergeEncounterTriggerConfigs(stageEncounterConfig, scenarioEncounterConfig);
  const encounterCards = primary.encounter_cards as unknown as EncounterCardData[];
  return {
    stageId: input.stageId,
    scenario,
    investigators,
    turn: {
      turnNumber: scenario.turnNumber,
      phase: 'investigator',
      actionPointsSpent: {},
      pendingLegendaryActions: [],
      triggeredReactions: [],
    },
    playerInvestigators,
    playerSaveIds,
    controllerByInvestigator,
    aiProfilesByInvestigator,
    aiStatesByInvestigator: {},
    declaredEndByInvestigator: [],
    roundRuntime: {
      mythosCards: primary.mythos_cards as any[],
      keeperProfile: defaultKeeperProfile(primary.keeper_settings, 4),
      attackCards: attackCardsFrom(primary),
      actCards: primary.stage.act_cards as any[],
      agendaCards: primary.stage.agenda_cards as any[],
      outcomes: (primary.chapter?.outcomes ?? []) as any[],
      encounterDeck: [...encounterCards],
      encounterSource: [...encounterCards],
      encounterTriggerConfig,
    },
    ruleContext: {
      cardLookup: cardLookupFrom(allBootstraps, builtStates),
      enemyStats: enemyDataFrom(primary),
      locationStats: locationStatsFrom(primary),
      stylePools: stylePoolsFrom(allBootstraps),
      actCards: primary.stage.act_cards as any[],
      chaosMarkerEffects: chaosMarkerEffectsFrom(primary),
    },
  };
}
