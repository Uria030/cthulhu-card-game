import { AI_INVESTIGATOR_ROSTER } from '@cthulhu/shared';
import type { MultiplayerRoomMember, StageBootstrap } from '@cthulhu/shared';
import { buildAuthoritativeMultiplayerGame, requiredAiTemplateIds } from './multiplayer-game-factory.js';
import { MultiplayerRoomService } from './multiplayer-rooms.js';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected=${String(expected)}, actual=${String(actual)}`);
}

function bootstrap(templateId: string, code: string): StageBootstrap {
  return {
    stage: {
      id: 'stage-rain', code: 'rain', name_zh: '雨夜的真相',
      scenarios: [{ id: 'scenario-rain', scenario_order: 1, name_zh: '雨夜', narrative: '', initial_location_codes: ['street'], initial_connections: [], investigator_spawn_location: 'street', initial_environment: { main: '夜間' }, initial_enemies: [] }],
      act_cards: [], agenda_cards: [], chaos_bag: { number_markers: { '0': 1 }, scenario_markers: {} },
    },
    campaign: { id: 'campaign-rain', code: 'rain', name_zh: '雨夜' },
    chapter: null,
    locations: [{ id: 'loc-street', code: 'street', name_zh: '雨街', shroud: 10, clues_base: 1, clues_per_player: 0 }],
    mythos_cards: [], encounter_cards: [], monsters: [], monster_attack_cards: [],
    investigator: {
      id: templateId, code, name_zh: code, attr_strength: 3, attr_agility: 3, attr_constitution: 3, attr_reflex: 3,
      attr_intellect: 3, attr_willpower: 3, attr_perception: 3, attr_charisma: 3, proficiency_ids: [],
      starting_deck: [{ deck_entry_id: `${templateId}-deck`, quantity: 6, slot_order: 1, card_definition_id: `${templateId}-card`, signature_card_id: null, weakness_id: null, card: { id: `${templateId}-card`, name_zh: '調查筆記', card_type: 'event', cost: 0, effects: [] }, signature_card: null, weakness: null }],
    },
    combat_style_pools: [],
  };
}

const members: MultiplayerRoomMember[] = [
  { playerId: 'p1', username: 'creator01', connected: true, joinedAt: 'now', investigatorTemplateId: 'human-1', ready: true },
  { playerId: 'p2', username: 'creator02', connected: true, joinedAt: 'now', investigatorTemplateId: 'human-2', ready: true },
];
const aiIds = requiredAiTemplateIds(members.map((member) => member.investigatorTemplateId!), 2);
assertEq(aiIds.length, 2, 'two AI vacancies use E13 roster');
const game = buildAuthoritativeMultiplayerGame({
  stageId: 'stage-rain',
  members,
  bootstraps: [
    { templateId: 'human-1', bootstrap: bootstrap('human-1', 'H1') },
    { templateId: 'human-2', bootstrap: bootstrap('human-2', 'H2') },
    ...aiIds.map((templateId, index) => ({ templateId, bootstrap: bootstrap(templateId, `AI${index + 1}`) })),
  ],
});

assertEq(Object.keys(game.investigators).length, 4, 'two humans plus two server AI seats');
assertEq(Object.keys(game.playerInvestigators).length, 2, 'only human accounts receive control mappings');
assertEq(Object.values(game.controllerByInvestigator ?? {}).filter((value) => value === 'human').length, 2, 'two human controllers');
assertEq(Object.values(game.controllerByInvestigator ?? {}).filter((value) => value === 'ai').length, 2, 'two AI controllers');
assertEq(Object.keys(game.aiProfilesByInvestigator ?? {}).length, 2, 'AI profiles remain on server runtime state');
assertEq(game.scenario.tokens[0]?.amount, 1, 'scenario token scaling uses the shared four-seat build');
assertEq(AI_INVESTIGATOR_ROSTER.some((profile) => aiIds.includes(profile.templateId)), true, 'AI templates come from E13 roster');

const service = new MultiplayerRoomService({ codeFactory: () => 'ABCDEF' });
const room = service.createRoom({ playerId: 'p1', username: 'creator01' });
if (!room.ok) throw new Error(room.error.message);
const joined = service.joinRoom(room.data.roomCode, { playerId: 'p2', username: 'creator02' });
if (!joined.ok) throw new Error(joined.error.message);
const activated = service.activateGame(room.data.roomCode, 'p1', game);
if (!activated.ok) throw new Error(activated.error.message);
for (const [investigatorId, controller] of Object.entries(game.controllerByInvestigator ?? {})) {
  if (controller === 'ai') {
    const ai = service.runAiTurn(room.data.roomCode, investigatorId);
    if (!ai.ok) throw new Error(ai.error.message);
  }
}
const endOne = service.declareActionEnd(room.data.roomCode, 'p1', 1);
const endTwo = service.declareActionEnd(room.data.roomCode, 'p2', 1);
if (!endOne.ok || !endTwo.ok) throw new Error('human end declaration failed');
assertEq(endTwo.data.snapshot.game?.scenario.phase, 'investigator', 'server resolves mythos and begins the next round');
assertEq(endTwo.data.snapshot.game?.turn.turnNumber, 2, 'server increments the shared turn after all declarations');
console.log('MP-N2 game factory: 2 passed, 0 failed');
