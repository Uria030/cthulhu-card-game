import { adminFetch, adminGet } from './api.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOG_DIR = path.join(ROOT, 'logs', 'claude-code');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logPath = path.join(LOG_DIR, `g1-style-cards-${stamp}.log`);
const lines = [];
function log(s = '') { lines.push(s); console.log(s); }

log(`# G1 戰鬥風格卡建立 ${stamp}`);

const csList = await adminGet('/api/combat-styles');
const csArr = csList.data || csList;
const shooting = csArr.find(s => s.code === 'shooting');
const brawl = csArr.find(s => s.code === 'brawl');
log(`shooting id=${shooting.id} / brawl id=${brawl.id}`);

// 既有風格卡(冪等檢查)
const shootingDetail = await adminGet(`/api/combat-styles/${shooting.id}/cards`);
const brawlDetail = await adminGet(`/api/combat-styles/${brawl.id}/cards`);
const existingNames = new Set([
  ...(shootingDetail.data || []).map(c => c.name_zh),
  ...(brawlDetail.data || []).map(c => c.name_zh),
]);
log(`既有風格卡: ${existingNames.size}`);

const SHOOTING_CARDS = [
  {
    name_zh: '精準射擊', name_en: 'Precise Shot', check_attribute: 'agility',
    narrative_attack_zh: '你閉上左眼，槍口慢慢追上目標的呼吸節奏。',
    narrative_attack_en: 'You close your left eye and let the muzzle drift to match the target\'s breath.',
    narrative_success_zh: '槍聲清脆，子彈正中要害。雨水沒能改變你的判斷。',
    narrative_success_en: 'A clean crack — the round finds its mark. Rain did not bend your aim.',
    narrative_fail_zh: '子彈擦過目標的肩胛，劃出一道焦黑的痕。你罵了聲髒話。',
    narrative_fail_en: 'The bullet grazes the shoulder, leaving a black scorch line. You curse under your breath.',
  },
  {
    name_zh: '快速擊發', name_en: 'Quick Fire', check_attribute: 'reflex',
    narrative_attack_zh: '不瞄準。你只相信肌肉記憶。',
    narrative_attack_en: 'No aim. Just muscle memory.',
    narrative_success_zh: '兩發在一秒內擊出，第二發卡進第一發的彈孔。',
    narrative_success_en: 'Two rounds in a second; the second slots into the hole left by the first.',
    narrative_fail_zh: '槍口跳得比你預期高，子彈打在牆上濺出磚屑。',
    narrative_fail_en: 'The recoil rides higher than you expect; the round chips brick from the wall.',
  },
  {
    name_zh: '冷靜瞄準', name_en: 'Cold Aim', check_attribute: 'perception',
    narrative_attack_zh: '你深吸一口氣，世界安靜下來。只剩下準星和那雙鰓。',
    narrative_attack_en: 'You draw a long breath; the world quiets to just the front sight and those gills.',
    narrative_success_zh: '一槍貫穿。她踉蹌一步，腥黏的液體濺在牆上。',
    narrative_success_en: 'One round, clean through. She staggers; viscous slime spatters the wall.',
    narrative_fail_zh: '你猶豫了一瞬。她已經側身。子彈射在身後的鐵皮上。',
    narrative_fail_en: 'You hesitated a heartbeat. She has already shifted. The round buries itself in tin sheeting behind her.',
  },
  {
    name_zh: '近身槍管', name_en: 'Pistol Whip', check_attribute: 'strength',
    narrative_attack_zh: '不夠時間裝彈。你倒握槍管朝她臉上掄過去。',
    narrative_attack_en: 'No time to reload. You flip the pistol and swing the barrel at her face.',
    narrative_success_zh: '鋼鐵砸在魚鰓上發出悶響，她被甩開半步。',
    narrative_success_en: 'Steel meets gill with a wet thud. She is knocked back half a step.',
    narrative_fail_zh: '她的爪先你一步擋下了槍管。你的手腕一陣酸麻。',
    narrative_fail_en: 'Her claw catches the barrel before yours can land. Your wrist sings with pain.',
  },
  {
    name_zh: '卡彈時刻', name_en: 'Cocked & Choked', check_attribute: 'reflex',
    narrative_attack_zh: '咔。退殼鉤沒反應。槍卡了。她的鰓在你面前張開。',
    narrative_attack_en: 'Click. The extractor does not catch. Jammed. Her gills yawn open in front of you.',
    narrative_success_zh: '你左手猛拉滑套，子彈彈出，下一發進膛——一槍逼她退後。',
    narrative_success_en: 'Your off-hand racks the slide; the dud ejects, the next round chambers — and the shot drives her back.',
    narrative_fail_zh: '滑套卡死。你只能用空槍頂住她的下顎，等待奇蹟。',
    narrative_fail_en: 'The slide locks. You can only press the dead pistol against her jaw and pray.',
  },
];

const BRAWL_CARDS = [
  {
    name_zh: '直拳重擊', name_en: 'Straight Punch', check_attribute: 'strength',
    narrative_attack_zh: '你後撤一步，整個身體的重量壓進右拳。',
    narrative_attack_en: 'You step back; your entire weight loads behind your right fist.',
    narrative_success_zh: '拳頭砸在她下顎，鰓口的軟組織發出令人作嘔的悶響。',
    narrative_success_en: 'The fist lands square on her jaw; the gill-tissue gives with a sick, soft crunch.',
    narrative_fail_zh: '她的脖子比你想的更靈活。你打了個空，自己往前栽。',
    narrative_fail_en: 'Her neck is more pliable than you expected. You whiff and stumble forward.',
  },
  {
    name_zh: '閃身擒拿', name_en: 'Slip & Grapple', check_attribute: 'agility',
    narrative_attack_zh: '她揮爪。你低頭側身，抓住她的手腕。',
    narrative_attack_en: 'She swipes. You duck, sidestep, and lock her wrist.',
    narrative_success_zh: '她的關節被反扣到背後。她掙扎了一下，沒甩開。',
    narrative_success_en: 'You torque her joint behind her back. She thrashes once, but cannot break free.',
    narrative_fail_zh: '她的皮膚比你預期更滑，黏液讓擒拿失效。',
    narrative_fail_en: 'Her skin is slicker than expected; the slime defeats your grip.',
  },
  {
    name_zh: '絕望反擊', name_en: 'Desperate Counter', check_attribute: 'reflex',
    narrative_attack_zh: '你已經半條命。她撲過來。你也撲過去。',
    narrative_attack_en: 'You are already half-dead. She lunges. You lunge back.',
    narrative_success_zh: '頭朝頭，肉貼肉——你比她更不要命。她退了。',
    narrative_success_en: 'Head to head, flesh to flesh — you want death less than she does. She breaks.',
    narrative_fail_zh: '你也撲過去。但她的爪比你的拳頭快了零點一秒。',
    narrative_fail_en: 'You lunged too. But her claw was a tenth of a second faster than your fist.',
  },
  {
    name_zh: '糾纏壓制', name_en: 'Tangle & Pin', check_attribute: 'constitution',
    narrative_attack_zh: '你不再嘗試擊倒她。你抱住她，把她拖到地上。',
    narrative_attack_en: 'You stop trying to take her down. You wrap her up and drag her to the ground.',
    narrative_success_zh: '她在你身下扭動，但你的體重壓住了她的爪。',
    narrative_success_en: 'She writhes beneath you, but your weight pins her claws.',
    narrative_fail_zh: '她比你想的強壯。你壓不住她，反而被她翻了過來。',
    narrative_fail_en: 'She is stronger than you reckoned. You cannot hold her — she rolls you instead.',
  },
  {
    name_zh: '撞擊頭錘', name_en: 'Skull Crack', check_attribute: 'strength',
    narrative_attack_zh: '你抓住她的領子，額頭朝她的鼻樑直衝。',
    narrative_attack_en: 'You grab her collar and drive your forehead at the bridge of her nose.',
    narrative_success_zh: '額骨對魚骨——一聲清脆的斷裂聲。她退三步，你也眼前發黑。',
    narrative_success_en: 'Skull on fish-bone — a clean snap. She reels back three steps; your own vision blacks out a heartbeat.',
    narrative_fail_zh: '你撞到的是她那副不該存在的下顎。你的額頭裂了，她沒事。',
    narrative_fail_en: 'You collided with that jaw that should not exist. Your forehead splits; she is fine.',
  },
];

let added = 0, skipped = 0, failed = 0;
async function postCard(styleId, card) {
  if (existingNames.has(card.name_zh)) {
    log(`⊙ skip: ${card.name_zh}`);
    skipped++;
    return;
  }
  const r = await adminFetch(`/api/combat-styles/${styleId}/cards`, {
    method: 'POST', body: JSON.stringify(card),
  });
  if (!r.ok) {
    log(`✗ ${card.name_zh}: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
    failed++;
    return;
  }
  log(`✓ ${card.name_zh} → ${r.body.data.code}`);
  added++;
}

log('\n── shooting 池 ──');
for (const c of SHOOTING_CARDS) await postCard(shooting.id, c);
log('\n── brawl 池 ──');
for (const c of BRAWL_CARDS) await postCard(brawl.id, c);

log(`\n=== 結果 === 新建 ${added} / 跳過 ${skipped} / 失敗 ${failed}`);
fs.writeFileSync(logPath, lines.join('\n'));
log(`log: ${logPath}`);
