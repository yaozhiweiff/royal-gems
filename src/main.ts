import './style.css';
import { GameEngine, LEVELS, findMove, type State, type Difficulty, type Tile, type Frame } from './engine';
import { CHARACTERS, characterImage, GEMS, assetUrl } from './assets';
import * as online from './online';
import { BoardScene, createBoard } from './scene';
import { characterSkills, type CharacterId } from './skills';
import { paceDuration, type MotionMode, type AnimationSpeed } from './motion';
import { COMBINATIONS } from './combinations';

const icons: Record<string, string> = {
  crown: '<path d="M3 7l5 4 4-7 4 7 5-4-2 12H5L3 7Z"/><path d="M6 22h12M7 15h10"/>',
  book: '<path d="M12 5C8 2 3 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 1Zm0 0v16"/>',
  sound: '<path d="M11 4 6 8H2v8h4l5 4V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H2v8h4l5 4V4Zm5 5 6 6m0-6-6 6"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  replay: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
  arrow: '<path d="M3 12h17m-6-6 6 6-6 6"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  bolt: '<path d="m14 2-9 12h7l-2 8 9-12h-7l2-8Z"/>',
  cross: '<path d="M12 2v20M2 12h20m-10-20-3 3m3-3 3 3"/>',
  inspect: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  settings: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="19" r="2"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const stored = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } };
let character = Math.max(0, CHARACTERS.findIndex(c => c.id === stored('royal-character', 'beth')));
const selectedCharacterId = () => CHARACTERS[character].id as CharacterId;
let engine = new GameEngine('easy', Math.random, selectedCharacterId());
let onlinePlayer: online.Player | null = null, accountLoading = true;
let displayed = engine.snapshot();
let busy = false, loaded = false, loadFailed = false;
let lastAction: [number, number] | null = null;
let actionSerial = 0;
let frameKind: Frame['kind'] | 'idle' = 'idle';
let activeCombination: Frame['combination'] | null = null;
let sound = stored('royal-sound', 'on') === 'on';
let audioContext: AudioContext | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let lastFocused: HTMLElement | null = null;
let clearFeedbackTimer: ReturnType<typeof setTimeout>;
const systemReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionMode: MotionMode = stored('royal-motion', 'full') === 'gentle' ? 'gentle' : 'full';
let animationSpeed: AnimationSpeed = stored('royal-animation-speed', 'normal') === 'slow' ? 'slow' : 'normal';

$('#app').innerHTML = `
  <div class="palace-background" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="#" aria-label="宫廷宝石首页"><span class="brand-seal">${icon('crown')}</span><span><strong>宫廷宝石</strong><small>ROYAL GEMS</small></span></a>
    <div class="header-caption"><span></span> 国王的抉择 · 宫廷试炼 <span></span></div>
    <nav aria-label="游戏菜单"><button class="text-button guide-button">${icon('book')}<span>玩法指南</span></button><i class="nav-divider"></i><button id="motion-settings" class="icon-button" aria-label="动画设置" title="动画设置">${icon('settings')}</button><button id="sound" class="icon-button" aria-label="关闭音效"></button><button id="pause" class="icon-button" aria-label="暂停游戏" disabled>${icon('pause')}</button></nav>
  </header>
  <main class="game-layout">
    <section class="companion" aria-label="助战角色">
      <div class="companion-heading"><span class="eyebrow">YOUR ROYAL COMPANION</span><span class="fine-rule"></span></div>
      <div class="portrait-stage">
        <div class="portrait-arch" aria-hidden="true"><span>✧</span></div>
        <img id="hero" class="hero-portrait" alt="贝丝" fetchpriority="high" />
        <div class="character-caption"><div class="small-label">宫廷同行者</div><h1 id="character-name">贝丝</h1><p id="character-phrase"></p></div>
        <div id="skill-banner" class="skill-banner" aria-live="polite"></div>
      </div>
      <div class="character-select-label"><span id="character-select-label">选择你的同行者</span><span class="tiny-diamond">◆</span></div>
      <div class="character-roster" role="group" aria-label="选择角色">${CHARACTERS.map((c, i) => `<button class="character-choice" data-character="${i}" aria-label="选择${c.name}" aria-pressed="${i === character}"><span class="avatar"><img src="${characterImage(c.id)}" alt="" style="object-position:${c.position}" /></span><span>${c.name}</span></button>`).join('')}</div>
      <div class="energy-panel">
        <div class="energy-heading"><span>${icon('bolt')} <span id="character-specialty">转色连锁</span></span><span><b id="energy-value">0</b><small> / 550</small></span></div>
        <div class="energy-track" role="progressbar" aria-label="角色能量" aria-valuemin="0" aria-valuemax="550" aria-valuenow="0"><div id="energy-fill"></div><i class="energy-tick"></i></div>
        <div class="skill-list"><button id="skill-one" class="skill-item" aria-label="查看宝石共鸣技能"><span class="skill-icon">${icon('spark')}</span><span><strong>宝石共鸣</strong><small id="skill-one-state">300 能量 · 自动释放</small></span></button><button id="skill-two" class="skill-item" aria-label="查看王室敕令技能"><span class="skill-icon">${icon('crown')}</span><span><strong>王室敕令</strong><small>550 能量 · 自动释放</small></span></button></div>
      </div>
    </section>
    <section class="challenge" aria-label="三消挑战">
      <div class="chapter-heading"><div><span class="eyebrow">CHAPTER I · THE ROYAL TRIAL</span><h2>王室试炼 <span id="difficulty-label">简单</span></h2></div><div class="best-score"><span id="best-label">通关最少回合</span><strong id="best-score">—</strong></div></div>
      <div class="scoreboard"><div class="score-group"><div class="score-label">${icon('spark')} <span id="score-label">目标积分</span><span class="score-number"><b id="score">0</b><span id="target-wrap"> / <span id="target">2,500</span></span></span></div><div class="score-track" role="progressbar" aria-label="关卡积分" aria-valuemin="0" aria-valuemax="2500" aria-valuenow="0"><div id="score-fill"></div></div></div><div class="turns"><strong id="turns">20</strong><span>剩余回合</span></div></div>
      <div class="board-frame"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i><div id="board-canvas"></div><div id="board-loading">正在布置宝石…</div><div id="combo" aria-live="polite"></div></div>
      <div class="board-message"><span class="status-dot"></span><span id="board-message">准备就绪，开启你的宫廷试炼</span></div>
      <div id="setup-actions" class="setup-actions"><div class="difficulty-control" role="group" aria-label="选择模式"><button data-difficulty="easy" aria-pressed="true">简单</button><button data-difficulty="hard" aria-pressed="false">困难</button><button data-difficulty="challenge" aria-pressed="false">挑战</button></div><button id="start" class="primary-button" disabled><span>开始挑战</span>${icon('arrow')}</button></div>
      <div class="rankings-bar"><button id="online-rankings" class="text-button">${icon('crown')} 联网排行榜</button><span id="ranking-status" class="ranking-status" role="status" title="按当前模式已提交的个人最佳成绩排名">登记名字后查看排名</span></div>
      <div id="play-actions" class="play-actions" hidden><span class="play-tip">交换相邻宝石 · 双击特殊宝石查看效果</span><div><button id="hint" class="text-button">${icon('spark')} 提示</button><button id="restart" class="text-button">${icon('replay')} 重来</button></div></div>
    </section>
  </main>
  <footer class="site-footer"><span id="player-name">正在连接账号…</span><button class="guide-button">消除规则 ${icon('arrow')}</button></footer>
  <div id="toast" role="status"></div>
  <dialog id="modal" aria-labelledby="modal-title"><div class="modal-inner"><button id="modal-close" class="icon-button" aria-label="关闭弹窗">${icon('close')}</button><div id="modal-content"></div></div></dialog>
`;

const modal = $<HTMLDialogElement>('#modal');
const scene = new BoardScene(displayed, move, () => {
  loaded = !loadFailed; $('#board-loading').hidden = !loadFailed; updateControls();
}, () => { loadFailed = true; $('#board-loading').textContent = '宝石素材加载失败，请刷新重试'; }, showGemDetails, showClearFeedback);
scene.setAnimationPreferences(motionMode, animationSpeed);
document.documentElement.dataset.motion = motionMode;
createBoard(scene);

function best() { return onlinePlayer?.bests.challenge ?? 0; }
function bestTurns() {
  const value = onlinePlayer?.bests[engine.state.difficulty] ?? 0;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
const escapeText = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
async function initializeAccount() {
  accountLoading = true; updateControls();
  try {
    onlinePlayer = (await online.account()).player;
    if (onlinePlayer) { $('#player-name').textContent = `玩家：${onlinePlayer.name}`; $('#modal-close').hidden = false; if (modal.open) closeModal(); updateHUD(engine.snapshot()); void refreshRankingStatus(); void online.retryPendingResults().then(applyBests); }
    else showRegistration();
  } catch (error) {
    openModal(`<h2 id="modal-title">连接游戏服务</h2><p class="modal-intro" id="account-error"></p><button id="account-retry" class="primary-button full">重新连接</button>`);
    $('#account-error').textContent = (error as Error).message; $('#account-retry').onclick = () => void initializeAccount(); $('#modal-close').hidden = true;
    $('#player-name').textContent = '游戏服务尚未连接';
  } finally { accountLoading = false; updateControls(); }
}
function showRegistration() {
  openModal(`<span class="eyebrow">WELCOME TO ROYAL GEMS</span><h2 id="modal-title">登记你的名字</h2><p class="modal-intro">名字就是你的账号，注册后会自动识别。同名不能重复注册，此浏览器设备只能绑定一个账号。</p><form id="register-form"><label for="register-name">玩家名字</label><input id="register-name" name="name" autocomplete="nickname" minlength="2" maxlength="16" required placeholder="2至16个汉字、字母或数字" /><p id="register-error" class="form-error" role="alert"></p><button id="register-submit" class="primary-button full">注册并进入游戏 ${icon('arrow')}</button></form><p class="inspect-note">请保留此浏览器的网站数据；清除数据或更换浏览器后无法自动找回设备账号，也无法保证物理设备只注册一次。</p>`);
  $('#modal-close').hidden = true;
  $('#register-form').onsubmit = async event => {
    event.preventDefault(); $<HTMLButtonElement>('#register-submit').disabled = true;
    try { onlinePlayer = (await online.register($<HTMLInputElement>('#register-name').value)).player; $('#modal-close').hidden = false; closeModal(); $('#player-name').textContent = `玩家：${onlinePlayer.name}`; updateHUD(engine.snapshot()); updateControls(); void refreshRankingStatus(); }
    catch (error) { if (error instanceof online.OnlineError && error.code === 'DEVICE_REGISTERED') { await initializeAccount(); return; } $('#register-error').textContent = (error as Error).message; $<HTMLButtonElement>('#register-submit').disabled = false; }
  };
  $<HTMLInputElement>('#register-name').focus();
}
const rankingRequests: Record<Difficulty, number> = { easy: 0, hard: 0, challenge: 0 };
function rankDescription(self: online.PersonalRank | null, mode: Difficulty) {
  if (!self) return mode === 'challenge' ? '当前未上榜 · 完成30回合后参与排名' : '当前未上榜 · 通关后参与排名';
  if (self.rank === 1) return '当前第 1 名 · 已位居榜首';
  if (self.gap === 0) return `当前第 ${self.rank.toLocaleString('en-US')} 名 · 与上一名${mode === 'challenge' ? '同分' : '回合相同'}，先达成者优先`;
  return `当前第 ${self.rank.toLocaleString('en-US')} 名 · 距上一名 ${self.gap!.toLocaleString('en-US')} ${mode === 'challenge' ? '分' : '回合'}`;
}
async function loadRankings(mode: Difficulty) {
  const request = ++rankingRequests[mode];
  const current = () => request === rankingRequests[mode] && mode === engine.state.difficulty;
  if (current()) $('#ranking-status').textContent = '正在读取当前排名…';
  try {
    const result = await online.rankings(mode);
    if (current()) $('#ranking-status').textContent = rankDescription(result.self, mode);
    return result;
  } catch (error) {
    if (current()) $('#ranking-status').textContent = '排名暂不可用 · 点击排行榜重试';
    throw error;
  }
}
async function refreshRankingStatus() {
  if (!onlinePlayer) return;
  try { await loadRankings(engine.state.difficulty); } catch { /* The status provides a retry through the leaderboard button. */ }
}
async function showRankings(mode = engine.state.difficulty) {
  if (busy || !onlinePlayer) return;
  openModal(`<span class="eyebrow">ROYAL LEADERBOARD</span><h2 id="modal-title">联网排行榜</h2><div class="ranking-tabs" role="group" aria-label="排行榜模式">${Object.entries(LEVELS).map(([key, value]) => `<button class="secondary-button" data-ranking="${key}" aria-pressed="${key === mode}">${value.name}</button>`).join('')}</div><p class="motion-hint">${mode === 'challenge' ? '挑战：积分越高，排名越靠前。' : `${LEVELS[mode].name}：通关回合越少，排名越靠前。`}每位玩家保留个人最佳成绩，展示前十名；同成绩以先达成为先。</p><div id="ranking-body" role="status">正在读取排行榜…</div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-ranking]').forEach(b => b.onclick = () => void showRankings(b.dataset.ranking as Difficulty));
  const container = $('#ranking-body');
  try {
    const { entries, self } = await loadRankings(mode); if (!container.isConnected) return;
    container.innerHTML = entries.length ? `<table class="challenge-table"><thead><tr><th>排名</th><th>玩家名字</th><th>角色</th><th>成绩</th></tr></thead><tbody>${entries.map((r, i) => `<tr class="${r.playerId === onlinePlayer?.id ? 'current-record' : ''}"><td>${i + 1}</td><td class="ranking-name">${escapeText(r.name)}</td><td>${CHARACTERS.find(c => c.id === r.character)?.name ?? '未知'}</td><td>${r.value.toLocaleString('en-US')} ${mode === 'challenge' ? '分' : '回合'}</td></tr>`).join('')}</tbody></table>` : '<p class="motion-hint">还没有有效成绩，来争夺第一名吧。</p>';
    const personal = document.createElement('p'); personal.className = 'ranking-personal'; personal.id = 'ranking-personal'; personal.textContent = rankDescription(self, mode); container.prepend(personal);
  } catch (error) { if (container.isConnected) { container.textContent = (error as Error).message; const retry = document.createElement('button'); retry.className = 'secondary-button'; retry.textContent = '重试'; retry.onclick = () => void showRankings(mode); container.append(retry); } }
}
function updateCharacter() {
  const c = CHARACTERS[character];
  const hero = $<HTMLImageElement>('#hero');
  hero.src = characterImage(c.id); hero.alt = c.name;
  hero.style.setProperty('--portrait-height', c.imageHeight); hero.style.setProperty('--portrait-top', c.imageTop); hero.style.setProperty('--portrait-shift', c.imageShift);
  $('#character-name').textContent = c.name; $('#character-phrase').textContent = `「 ${c.phrase} 」`;
  document.querySelectorAll<HTMLButtonElement>('[data-character]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.character) === character)));
  const kit = characterSkills(selectedCharacterId(), engine.state.difficulty);
  $('#character-specialty').textContent = kit.style;
  ['#skill-one', '#skill-two'].forEach((selector, i) => {
    $(`${selector} strong`).textContent = kit.skills[i].name;
    $(selector).setAttribute('aria-label', `查看${kit.skills[i].name}技能`);
    $(selector).title = kit.skills[i].description;
  });
  save('royal-character', c.id);
}
function updateHUD(state: State) {
  displayed = state;
  const level = LEVELS[state.difficulty];
  $('#score').textContent = state.score.toLocaleString('en-US');
  const challenge = state.difficulty === 'challenge', maximum = level.target ?? 30;
  const progress = challenge ? 30 - state.turns : Math.min(state.score, maximum);
  $('#score-label').textContent = challenge ? '挑战积分' : '目标积分';
  $('#target-wrap').hidden = challenge;
  $('#target').textContent = level.target?.toLocaleString('en-US') ?? '';
  $('#turns').textContent = String(state.turns);
  $('.turns').classList.toggle('low', state.turns <= 5);
  $('#score-fill').style.width = `${Math.min(100, progress / maximum * 100)}%`;
  $('.score-track').setAttribute('aria-label', challenge ? '已用挑战回合' : '关卡积分');
  $('.score-track').setAttribute('aria-valuenow', String(progress));
  $('.score-track').setAttribute('aria-valuemax', String(maximum));
  $('#energy-value').textContent = String(state.energy);
  $('#energy-fill').style.width = `${Math.min(100, state.energy / 550 * 100)}%`;
  $('.energy-track').setAttribute('aria-valuenow', String(Math.min(state.energy, 550)));
  $('#skill-one').classList.toggle('charged', state.firstFired);
  $('#skill-one-state').textContent = state.firstFired ? '本轮已释放' : '300 能量 · 自动释放';
  $('#difficulty-label').textContent = level.name;
  $('#best-label').textContent = challenge ? '个人最佳积分' : '通关最少回合';
  $('#best-score').textContent = challenge ? best().toLocaleString('en-US') : bestTurns() ? `${bestTurns()} 回合` : '—';
}
function updateControls() {
  const ready = engine.state.status === 'ready';
  const playing = engine.state.status === 'playing';
  $('#setup-actions').hidden = !ready;
  $('#play-actions').hidden = ready;
  $<HTMLButtonElement>('#start').disabled = !loaded || busy || accountLoading || !onlinePlayer;
  $<HTMLButtonElement>('#pause').disabled = !playing || busy;
  $<HTMLButtonElement>('#hint').disabled = !playing || busy;
  $<HTMLButtonElement>('#restart').disabled = busy;
  $<HTMLButtonElement>('#motion-settings').disabled = busy;
  $<HTMLButtonElement>('#online-rankings').disabled = busy || !onlinePlayer;
  document.querySelectorAll<HTMLButtonElement>('[data-character], [data-difficulty]').forEach(b => b.disabled = !ready || busy);
  $('#character-select-label').textContent = ready ? '选择你的同行者' : `与${CHARACTERS[character].name}同行`;
  scene.enabled = loaded && playing && !busy && !modal.open && !!onlinePlayer;
  scene.setLayoutBusy(busy);
  $('.board-frame').classList.toggle('playing', playing);
}
function toast(message: string) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2600);
}
function tone(kind: 'move' | 'clear' | 'skill' | 'win' | 'invalid', combo = 1, tier = 0) {
  if (!sound) return;
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
    const root = 523 * Math.pow(2, Math.min(Math.max(combo - 1, 0), 5) / 12);
    const frequencies = kind === 'clear' ? [1, 1.25, 1.5, 2].slice(0, tier + 1).map(ratio => root * ratio) : kind === 'skill' || kind === 'win' ? [523, 659, 784] : [kind === 'invalid' ? 180 : 350];
    frequencies.forEach((frequency, i) => {
      const start = audioContext!.currentTime + i * (kind === 'clear' ? .045 : .09);
      const oscillator = audioContext!.createOscillator(), gain = audioContext!.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
      const duration = kind === 'clear' ? .2 + tier * .045 : .22;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.035 / Math.sqrt(frequencies.length), start + .012); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.connect(gain); gain.connect(audioContext!.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* Sound is optional; gameplay remains available. */ }
}
function clearFeedback() {
  clearTimeout(clearFeedbackTimer);
  $('#combo').classList.remove('visible');
  delete $('.board-frame').dataset.clearTier;
}
function showClearFeedback(frame: Frame, tier: number, count: number) {
  clearFeedback();
  tone('clear', frame.combo, tier);
  const combo = frame.combo ?? 1;
  const combined = frame.combination ? COMBINATIONS[frame.combination.kind] : null;
  const titles = ['宝石消除', '璀璨消除', '华丽绽放', '王室盛放'];
  $('#board-message').textContent = `${combined ? `${combined.name} · ` : ''}${combo > 1 ? `${combo} 次连锁 · ` : ''}消除 ${count} 颗宝石，获得 ${frame.points} 分`;
  if (tier > 0 || combo > 1 || combined) {
    const feedback = $('#combo');
    feedback.innerHTML = `<span class="clear-ornament" aria-hidden="true">✧</span><span><strong>${combined?.name ?? (tier ? titles[tier] : '连锁消除')}</strong><small>${count} 颗宝石${combo > 1 ? ` · ${combo} 次连锁` : ''}</small></span><span class="clear-ornament" aria-hidden="true">✧</span>`;
    feedback.dataset.tier = String(tier);
    feedback.classList.add('visible');
    if (!scene.reducedMotion) {
      feedback.getAnimations().forEach(animation => animation.cancel());
      feedback.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(6px) scale(.94)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: paceDuration(170), easing: 'ease-out' });
    }
  }
  if (tier > 0 && !scene.reducedMotion) $('.board-frame').dataset.clearTier = String(tier);
  clearFeedbackTimer = setTimeout(clearFeedback, scene.getEffectStats().duration + paceDuration(380));
}
function syncSound() { $('#sound').innerHTML = icon(sound ? 'sound' : 'mute'); $('#sound').setAttribute('aria-label', sound ? '关闭音效' : '开启音效'); $('#sound').setAttribute('aria-pressed', String(sound)); }
async function move(a: number, b: number) {
  if (busy || modal.open || engine.state.status !== 'playing' || !onlinePlayer) return;
  if (import.meta.env.DEV) { lastAction = [a, b]; actionSerial++; }
  busy = true; updateControls(); tone('move');
  let previous = displayed;
  try {
    const result = online.moveRun(a, b);
    const frames = result.frames; engine.state = result.state;
    for (const frame of frames) {
      frameKind = frame.kind;
      activeCombination = frame.combination ?? null;
      updateHUD(frame.state);
      if (frame.kind === 'combine' && frame.combination) {
        clearFeedback();
        const combination = COMBINATIONS[frame.combination.kind];
        $('#board-message').textContent = `${combination.name}：${combination.description}`;
        $('#combo').innerHTML = `<span class="clear-ornament" aria-hidden="true">✧</span><span><strong>${combination.name}</strong><small>${combination.pair}</small></span><span class="clear-ornament" aria-hidden="true">✧</span>`;
        $('#combo').classList.add('visible'); tone('skill');
      }
      if (frame.kind === 'skill') {
        tone('skill');
        const skill = characterSkills(frame.state.character, frame.state.difficulty).skills[(frame.skill ?? 1) - 1];
        const name = CHARACTERS.find(c => c.id === frame.state.character)!.name;
        $('#skill-banner').innerHTML = `${icon(frame.skill === 1 ? 'spark' : 'crown')}<span>${name} · ${skill.name}</span>`;
        $('#skill-banner').dataset.character = frame.state.character;
        $('#skill-banner').classList.add('visible');
        $('#board-message').textContent = `${skill.name}：${skill.description}`;
      }
      if (frame.kind === 'invalid') { toast('连成三个同色宝石即可消除，本次不扣回合'); tone('invalid'); }
      if (frame.kind === 'shuffle') toast('暂无可消除组合，已自动重排，不扣回合');
      await scene.play(frame, previous);
      previous = frame.state;
      if (frame.kind === 'skill') $('#skill-banner').classList.remove('visible');
    }
  } catch (error) { toast((error as Error).message); }
  finally { busy = false; frameKind = 'idle'; activeCombination = null; updateControls(); clearFeedback(); }
  const status = engine.snapshot().status;
  if (status === 'won' || status === 'lost' || status === 'completed') finish();
}
function reset(difficulty = engine.state.difficulty, start = false) {
  clearFeedback(); scene.clearEffects();
  closeModal(); engine = new GameEngine(difficulty, Math.random, selectedCharacterId());
  updateCharacter();
  scene.clearHints(); void scene.renderState(engine.snapshot());
  updateHUD(engine.snapshot()); updateControls();
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.difficulty === difficulty)));
  $('#board-message').textContent = difficulty === 'challenge' ? '固定30回合，挑战更高积分；完成后参与联网排行' : start ? '交换相邻宝石，开启第一步' : '准备就绪，开启你的宫廷试炼';
  void refreshRankingStatus();
  if (start) void startGame();
}
async function startGame() {
  if (busy || !onlinePlayer || accountLoading) return;
  busy = true; updateControls();
  try {
    engine.state = await online.startRun(engine.state.difficulty, selectedCharacterId());
    scene.clearEffects(); await scene.renderState(engine.snapshot()); updateHUD(engine.snapshot());
    $('#board-message').textContent = '交换相邻宝石，开启第一步'; tone('move');
  } catch (error) { toast((error as Error).message); }
  finally { busy = false; updateControls(); }
}
function openModal(content: string) {
  lastFocused = document.activeElement as HTMLElement;
  $('#modal-content').innerHTML = content;
  if (!modal.open) modal.showModal();
  scene.enabled = false;
  $<HTMLButtonElement>('#modal-close').focus();
}
function closeModal() { if (!onlinePlayer) return; if (modal.open) modal.close(); updateControls(); lastFocused?.focus(); }
function showMotionSettings() {
  if (busy) return;
  openModal(`<span class="eyebrow">ANIMATION & PACE</span><h2 id="modal-title">动画设置</h2><p class="modal-intro">看清宝石聚能、绽放与下落，让每一轮消除都有从容的节奏。</p>
    <div class="motion-options"><label for="motion-mode">消除表现</label><select id="motion-mode"><option value="full" ${motionMode === 'full' ? 'selected' : ''}>完整特效 · 碎晶、星芒与波纹</option><option value="gentle" ${motionMode === 'gentle' ? 'selected' : ''}>柔和特效 · 高亮与缓慢淡出</option></select>
    <label for="animation-speed">播放速度</label><select id="animation-speed"><option value="slow" ${animationSpeed === 'slow' ? 'selected' : ''}>慢速 · 从容欣赏</option><option value="normal" ${animationSpeed === 'normal' ? 'selected' : ''}>标准 · 更紧凑的节奏（默认）</option></select></div>
    <p class="motion-hint">柔和模式保留清晰的消除提示，减少飞散与扩散动作。${systemReducedMotion ? '检测到系统偏好减少动态效果；你仍可在这里选择完整特效。' : ''}设置将自动记住，不影响当前对局进度。</p>
    <button id="motion-save" class="primary-button full">保存设置 ${icon('arrow')}</button>`);
  $('#motion-save').onclick = () => {
    motionMode = $<HTMLSelectElement>('#motion-mode').value === 'gentle' ? 'gentle' : 'full';
    animationSpeed = $<HTMLSelectElement>('#animation-speed').value === 'normal' ? 'normal' : 'slow';
    save('royal-motion', motionMode); save('royal-animation-speed', animationSpeed);
    scene.setAnimationPreferences(motionMode, animationSpeed);
    document.documentElement.dataset.motion = motionMode;
    closeModal(); toast(`已启用${motionMode === 'full' ? '完整' : '柔和'}特效 · ${animationSpeed === 'slow' ? '慢速' : '标准'}播放`);
  };
}
function showCharacterSkills(focus: number) {
  if (busy) return;
  const c = CHARACTERS[character], kit = characterSkills(selectedCharacterId(), engine.state.difficulty);
  openModal(`<div class="role-skill-heading"><span class="avatar"><img src="${characterImage(c.id)}" alt="${c.name}" style="object-position:${c.position}" /></span><div><span class="eyebrow">${kit.style}</span><h2 id="modal-title">${c.name}的技能</h2></div></div>
    <div class="role-skill-cards">${kit.skills.map((skill, i) => `<article class="${i === focus ? 'focused-skill' : ''}"><div class="role-skill-cost">${skill.energy}<small>能量</small></div><div><h3>${skill.name}</h3><p>${skill.description}</p><small>充能达标自动释放${i === 0 && engine.state.firstFired ? ' · 本轮已释放' : ''}</small></div></article>`).join('')}</div>
    <p class="motion-hint">每次有效行动获得50能量，每消除1颗额外获得2能量。两项技能依次释放，第二项释放后开始新一轮充能。点击技能只查看说明，不会主动施放。</p><button id="skills-done" class="primary-button full">我明白了 ${icon('arrow')}</button>`);
  $('#skills-done').onclick = closeModal;
}
function showGemDetails(tile: Tile) {
  if (tile.special === 'normal' || busy || modal.open) return;
  const details = {
    bomb: {
      name: '爆炸宝石', formation: '直线消除4颗同色宝石时生成。',
      effect: '以自身为中心，清除周围3×3范围内的宝石。位于棋盘边缘时，只清除棋盘内的格子。',
      activation: '与同色宝石组成消除，或被其他特殊宝石的效果命中时触发。与相邻特殊宝石交换时，触发组合。',
    },
    cross: {
      name: '十字宝石', formation: '以T形或L形消除5颗及以上同色宝石时生成。',
      effect: '清除自身所在整行和整列的所有宝石。',
      activation: '与同色宝石组成消除，或被其他特殊宝石的效果命中时触发。与相邻特殊宝石交换时，触发组合。',
    },
    ultimate: {
      name: '终极宝石', formation: '直线消除5颗及以上同色宝石时生成，外观为彩色问号。',
      effect: '与普通宝石交换，清除棋盘上所有该颜色的宝石；与另一颗终极宝石交换，清空整个棋盘。',
      activation: '交换即可触发。若被其他特殊宝石的效果命中，则清除当前数量最多的一种颜色。',
    },
  }[tile.special];
  const texture = tile.special === 'ultimate' ? 'ultimate' : GEMS[tile.color];
  openModal(`<div class="gem-detail-heading"><div class="rule-gem inspect-preview ${tile.special}"><img src="${assetUrl(`gems/${texture}.png`)}" alt="${details.name}" /><span class="inspect-preview-badge">${icon('inspect')}</span></div><div><span class="eyebrow">SPECIAL GEM</span><h2 id="modal-title">${details.name}</h2></div></div>
    <dl class="gem-detail-list"><div><dt>宝石效果</dt><dd>${details.effect}</dd></div><div><dt>触发方式</dt><dd>${details.activation}</dd></div><div><dt>生成条件</dt><dd>${details.formation}</dd></div><div><dt>组合交换</dt><dd>${Object.entries(COMBINATIONS).filter(([kind]) => kind.includes(tile.special)).map(([, combination]) => `${combination.pair}：${combination.description}`).join('<br>')}</dd></div></dl>
    <p class="inspect-note">查看说明不消耗回合，关闭后可继续当前对局。</p><button id="inspect-done" class="primary-button full">继续游戏 ${icon('arrow')}</button>`);
  $('#inspect-done').onclick = closeModal;
}
function showRules(section = '') {
  openModal(`<span class="eyebrow">A GUIDE TO THE ROYAL TRIAL</span><h2 id="modal-title">${section || '玩法指南'}</h2><p class="modal-intro">交换、消除、积攒能量。让每一步，都成为连锁的开始。</p>
    <div class="rule-basics"><b>三个相连，即可消除</b><p>横向或纵向连成至少3颗同色宝石。每消除1颗获得10分。无效交换不扣回合，连锁下落不额外扣回合。</p><p>简单和困难按通关回合从低到高排名；挑战模式固定30回合，按积分从高到低排名。联网排行榜分别展示前十位玩家的名字、角色和最佳成绩。伊恩的从容布局在挑战模式改为生成1颗爆炸宝石。</p></div>
    <div class="rule-specials"><article><div class="rule-gem bomb"><img src="${assetUrl('gems/red.png')}" alt="爆炸宝石" /></div><div><h3>爆炸棋子 <small>直线4连</small></h3><p>参与消除时，清除周围3×3范围的棋子。</p></div></article><article><div class="rule-gem cross"><img src="${assetUrl('gems/green.png')}" alt="十字宝石" /></div><div><h3>十字棋子 <small>T形 / L形5连及以上</small></h3><p>参与消除时，清除自身所在的整行和整列。</p></div></article><article><div class="rule-gem"><img src="${assetUrl('gems/ultimate.png')}" alt="问号终极棋子" /></div><div><h3>终极棋子 <small>直线5连及以上</small></h3><p>与普通棋子交换，清除全盘该颜色；两个终极棋子交换，清空棋盘。</p></div></article></div>
    <div class="rule-skills"><h3>${icon('bolt')} ${CHARACTERS[character].name} · ${characterSkills(selectedCharacterId(), engine.state.difficulty).style}</h3><p>每次有效行动获得50能量，每消除1颗额外获得2能量。不同角色拥有不同技能，充能达标自动释放。</p><dl>${characterSkills(selectedCharacterId(), engine.state.difficulty).skills.map(skill => `<div><dt>${skill.energy} <span>${skill.name}</span></dt><dd>${skill.description}</dd></div>`).join('')}</dl><p>第二项技能释放后，充能条重置，重新积攒。</p></div>
    <div class="rule-skills rule-combinations"><h3>${icon('spark')} 特殊宝石组合</h3><p>两颗相邻特殊宝石直接交换即可触发，无需同色或三连；只消耗一个回合。组合命中的其他特殊宝石继续连锁，边缘范围以棋盘为界。</p><dl>${Object.values(COMBINATIONS).map(combination => `<div><dt>${combination.pair}</dt><dd>${combination.description}</dd></div>`).join('')}</dl></div>
    <p class="keyboard-note">双击特殊宝石或点击其右下角放大镜，可查看效果说明，不消耗回合。<br>鼠标拖动或依次点选相邻宝石 · 触屏滑动 / 双点查看 · 方向键 + 空格操作，I键查看特殊宝石</p><button id="rules-done" class="primary-button full">我明白了 ${icon('arrow')}</button>`);
  $('#rules-done').onclick = closeModal;
}
function confirmRestart() {
  openModal(`<span class="eyebrow">A FRESH START</span><h2 id="modal-title">返回选择界面？</h2><p class="modal-intro">本局进度将重置，返回后可以重新选择难度和英雄。</p><div class="modal-actions"><button id="keep-playing" class="secondary-button">继续本局</button><button id="confirm-restart" class="primary-button">返回选择 ${icon('replay')}</button></div>`);
  $('#keep-playing').onclick = closeModal; $('#confirm-restart').onclick = () => reset();
}
function applyBests(bests: online.Player['bests'] | undefined) {
  if (!onlinePlayer || !bests) return;
  for (const mode of ['easy', 'hard', 'challenge'] as const) {
    const value = bests[mode], previous = onlinePlayer.bests[mode];
    if (value && Number.isSafeInteger(value)) onlinePlayer.bests[mode] = previous ? (mode === 'challenge' ? Math.max(previous, value) : Math.min(previous, value)) : value;
  }
  updateHUD(displayed); void refreshRankingStatus();
  const sync = document.querySelector('#result-sync'), retry = document.querySelector<HTMLButtonElement>('#result-submit-retry');
  if (sync && !online.hasPendingResult()) { sync.textContent = '成绩已提交'; if (retry) retry.hidden = true; }
  const tab = document.querySelector<HTMLButtonElement>('[data-ranking][aria-pressed="true"]');
  if (tab && !busy) void showRankings(tab.dataset.ranking as Difficulty);
}
function submitFinishedResult() {
  const status = document.createElement('p'), retry = document.createElement('button');
  status.id = 'result-sync'; status.className = 'motion-hint'; status.setAttribute('role', 'status');
  retry.id = 'result-submit-retry'; retry.className = 'secondary-button full'; retry.textContent = '重试提交成绩'; retry.hidden = true;
  $('#modal-content').append(status, retry);
  const submit = async () => {
    retry.hidden = true; status.textContent = '正在提交本局成绩…';
    try { applyBests(await online.completeRun()); if (status.isConnected) status.textContent = '成绩已提交'; }
    catch { if (status.isConnected) { status.textContent = '成绩暂未提交，请恢复网络后重试。'; retry.hidden = false; } }
  };
  retry.onclick = () => void submit(); void submit();
}
window.addEventListener('online', () => { if (onlinePlayer) void online.retryPendingResults().then(applyBests); });
function finish() {
  const s = engine.state, won = s.status === 'won', previousBest = best();
  const previousTurns = bestTurns(), newTurnRecord = won && (!previousTurns || s.moves < previousTurns);
  updateHUD(s); tone(won || s.status === 'completed' ? 'win' : 'invalid');
  void refreshRankingStatus();
  if (s.difficulty === 'challenge') {
    const difference = s.score - previousBest;
    $('#board-message').textContent = '30回合挑战完成';
    openModal(`<div class="result-seal">${icon('crown')}</div><span class="eyebrow">THE SCORE CHALLENGE</span><h2 id="modal-title">挑战完成</h2><div class="result-score">${s.score.toLocaleString('en-US')}<small>本次积分${difference > 0 ? ' · 新的个人最佳' : ''}</small></div><p class="modal-intro">此前最佳：${previousBest.toLocaleString('en-US')} 分 · ${difference > 0 ? `超出 ${difference.toLocaleString('en-US')} 分` : difference < 0 ? `相差 ${Math.abs(difference).toLocaleString('en-US')} 分` : '追平最佳成绩'}</p><button id="result-rankings" class="secondary-button full">查看联网排行榜</button><div class="modal-actions"><button id="result-back" class="secondary-button">返回准备</button><button id="result-replay" class="primary-button">再次挑战 ${icon('arrow')}</button></div>`);
    $('#result-rankings').onclick = () => void showRankings('challenge');
    $('#result-back').onclick = () => reset(); $('#result-replay').onclick = () => reset('challenge', true);
    submitFinishedResult();
    return;
  }
  $('#board-message').textContent = won ? '目标达成，王室试炼完成' : '本次回合已用尽，再试一次吧';
  const comparison = !previousTurns ? '首次通关记录' : s.moves < previousTurns ? `此前最少 ${previousTurns} 回合，本次少用 ${previousTurns - s.moves} 回合` : s.moves === previousTurns ? '追平最少回合记录' : `此前最少 ${previousTurns} 回合，本次多用 ${s.moves - previousTurns} 回合`;
  openModal(`<div class="result-seal">${icon(won ? 'crown' : 'spark')}</div><span class="eyebrow">${won ? 'A ROYAL ACHIEVEMENT' : 'EVERY MOVE, A NEW POSSIBILITY'}</span><h2 id="modal-title">${won ? '试炼完成' : '再赴一场试炼'}</h2><p class="modal-intro">${won ? comparison : '回合已用尽，巧用特殊宝石与角色技能，再试一次。'}</p><div class="result-score">${won ? s.moves : s.score.toLocaleString('en-US')}<small>${won ? `通关所用回合${newTurnRecord ? ' · 新的最少回合记录' : ''}` : '本局积分'}</small></div><div class="result-details"><span>${LEVELS[s.difficulty].name}难度</span><span>积分 ${s.score.toLocaleString('en-US')}</span><span>本次 ${s.moves} 回合</span></div><div class="modal-actions"><button id="result-back" class="secondary-button">返回准备</button><button id="result-replay" class="primary-button">再来一局 ${icon('arrow')}</button></div>`);
  const rankingButton = document.createElement('button'); rankingButton.id = 'result-rankings'; rankingButton.className = 'secondary-button full'; rankingButton.textContent = '查看联网排行榜'; rankingButton.onclick = () => void showRankings(s.difficulty); $('#modal-content').append(rankingButton);
  $('#result-back').onclick = () => reset(); $('#result-replay').onclick = () => reset(s.difficulty, true);
  if (won) submitFinishedResult();
}

document.querySelectorAll<HTMLButtonElement>('[data-character]').forEach(button => button.onclick = () => { if (busy || engine.state.status !== 'ready') return; character = Number(button.dataset.character); engine.state.character = selectedCharacterId(); updateCharacter(); updateHUD(engine.snapshot()); tone('move'); });
document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(button => button.onclick = () => reset(button.dataset.difficulty as Difficulty));
document.querySelectorAll<HTMLButtonElement>('.guide-button').forEach(button => button.onclick = () => { if (!busy) showRules(); });
$('#skill-one').onclick = () => showCharacterSkills(0);
$('#skill-two').onclick = () => showCharacterSkills(1);
$('#motion-settings').onclick = showMotionSettings;
$('#online-rankings').onclick = () => void showRankings();
$('#start').onclick = () => void startGame();
$('#hint').onclick = () => { const pair = findMove(engine.state.board); if (pair) { scene.showHint(pair); toast('试试交换高亮的两颗宝石'); } };
$('#restart').onclick = () => engine.state.status === 'playing' ? confirmRestart() : reset();
$('#sound').onclick = () => { sound = !sound; save('royal-sound', sound ? 'on' : 'off'); syncSound(); if (sound) tone('move'); };
$('#pause').onclick = () => {
  openModal(`<div class="result-seal">${icon('pause')}</div><span class="eyebrow">TAKE YOUR TIME</span><h2 id="modal-title">片刻休憩</h2><p class="modal-intro">宝石静候，思绪从容。</p><div class="modal-actions"><button id="pause-home" class="secondary-button">返回准备</button><button id="resume" class="primary-button">继续挑战 ${icon('arrow')}</button></div>`);
  $('#resume').onclick = closeModal;
  $('#pause-home').onclick = () => {
    openModal(`<h2 id="modal-title">返回准备界面？</h2><p class="modal-intro">本局进度将重置，之后可以重新选择角色和难度。</p><div class="modal-actions"><button id="cancel-home" class="secondary-button">继续本局</button><button id="confirm-home" class="primary-button">返回准备</button></div>`);
    $('#cancel-home').onclick = closeModal; $('#confirm-home').onclick = () => reset();
  };
};
$('#modal-close').onclick = closeModal;
modal.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); } });
$('.brand').onclick = event => { event.preventDefault(); if (!busy && engine.state.status === 'ready') reset(); else if (!busy) $('#pause').click(); };
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.open && !busy && engine.state.status === 'playing') $('#pause').click(); });
updateCharacter(); updateHUD(displayed); updateControls(); syncSound();
void initializeAccount();

// Local development only: deterministic engine and browser acceptance tests.
if (import.meta.env.DEV) {
  Object.assign(window, { __royalGems: {
    state: () => engine.snapshot(), hint: () => findMove(engine.state.board), busy: () => busy, move, effects: () => scene.getEffectStats(),
    presentation: () => ({ mode: motionMode, speed: animationSpeed, systemReducedMotion, frameKind, combination: activeCombination }), creation: () => scene.getSpecialCreationStats(), displayed: () => structuredClone(displayed),
    load: (state: Partial<State>) => { clearFeedback(); scene.clearEffects(); Object.assign(engine.state, state); void scene.renderState(engine.snapshot()); updateHUD(engine.snapshot()); updateControls(); },
    newTile: (color: number, special = 'normal') => engine.tile(color, special as 'normal'),
    assets: GEMS,
    layout: () => scene.getBoardLayout(),
    input: () => ({ pair: lastAction, serial: actionSerial, ...scene.getInputStats() }),
  } });
}
