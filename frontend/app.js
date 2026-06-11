const config = window.APP_CONFIG || {};
const API_BASE = (config.API_BASE || "").replace(/\/$/, "");
const OFFLINE_DEMO = !API_BASE || API_BASE.includes("YOUR_SUBDOMAIN");
const DEMO_AD_CALLBACKS = Boolean(config.DEMO_AD_CALLBACKS);
const adControllers = {};
const AD_REWARD_AMOUNT = 5;
const COINS_PER_RUPEE = 2;
const MIN_WITHDRAWAL_COINS = 1000;
const BONUS_WITHDRAWAL_COINS = 2000;
const BONUS_WITHDRAWAL_RUPEES = 50;
const ENERGY_MAX = 10;
const ENERGY_BOOST_CAP = 15;
const SPIN_CAP = 15;
const CHALLENGE_CAP = 15;
const FREE_SPIN_PREFIX = "missionvault.freeSpinUsed.";
const CHALLENGE_REWARDS = [2, 2, 3, 3, 5, 5, 8, 8, 10, 10, 15, 15, 20, 25, 50];
const SPIN_SEGMENTS = [
  { id: 1, reward: 500, label: "+500", tease: false },
  { id: 2, reward: 100, label: "+100", tease: false },
  { id: 3, reward: 5, label: "+5", tease: true },
  { id: 4, reward: 50, label: "+50", tease: false },
  { id: 5, reward: 0, label: "0", tease: true },
  { id: 6, reward: 20, label: "+20", tease: false },
  { id: 7, reward: 10, label: "+10", tease: true },
  { id: 8, reward: 5, label: "+5", tease: true },
];

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const demoUser = {
  id: 100001,
  username: "demo_user",
  first_name: "Demo",
  photo_url: "",
};

const tgUser = tg?.initDataUnsafe?.user || demoUser;
const startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("start");
const AD_NETWORKS = ["adsgram", "monetag"];
const DAILY_AD_MAX = AD_NETWORKS.length * 10 * AD_REWARD_AMOUNT;
const VALID_SCREENS = new Set(["home", "challenge", "leaderboard", "refer", "withdraw"]);
const FAKE_LEADERS = [
  { name: "Rahul_G", coins: 12450, withdrawn: 5820 },
  { name: "priya.m99", coins: 11230, withdrawn: 5100 },
  { name: "Karan_Plays", coins: 10890, withdrawn: 4980 },
  { name: "sunny_bhai", coins: 9750, withdrawn: 4200 },
  { name: "DeepakXYZ", coins: 9100, withdrawn: 3900 },
  { name: "anita.k", coins: 8670, withdrawn: 3600 },
  { name: "RajPatel07", coins: 7980, withdrawn: 3200 },
  { name: "mohit_earn", coins: 7450, withdrawn: 2900 },
  { name: "shweta.wins", coins: 6890, withdrawn: 2700 },
  { name: "Vikram_India", coins: 6230, withdrawn: 2400 },
  { name: "lucky786", coins: 5780, withdrawn: 2100 },
  { name: "neha_coins", coins: 5100, withdrawn: 1980 },
  { name: "ArjunSpin", coins: 4670, withdrawn: 1800 },
  { name: "pooja.earn", coins: 3980, withdrawn: 1500 },
  { name: "Rohit_Bhai", coins: 3200, withdrawn: 1200 },
];

function getInitialScreen() {
  const rawHash = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (VALID_SCREENS.has(rawHash)) return rawHash;

  const queryScreen = new URLSearchParams(location.search).get("screen");
  if (VALID_SCREENS.has(queryScreen)) return queryScreen;

  const hashScreen = new URLSearchParams(rawHash).get("screen");
  if (VALID_SCREENS.has(hashScreen)) return hashScreen;

  return "home";
}

const state = {
  user: null,
  activeScreen: getInitialScreen(),
  energy: null,
  challenges: null,
  wheelTurns: 0,
  loading: false,
};

const mockState = {
  tasks: [
    { id: 1, channel_username: "@open_link_and_earn", channel_name: "Update Channel", reward_amount: 10, completed: false },
    { id: 2, channel_username: "@link69_viral", channel_name: "Partner / Sponsor", reward_amount: 10, completed: false },
  ],
  withdrawals: [],
  energy: {
    energy: 0,
    boosts_today: 0,
    reset_date: new Date().toISOString().slice(0, 10),
    max_energy: 10,
    boost_daily_cap: 15,
    spins_today: 0,
    spins_left: 15,
    free_spin_used: false,
    free_spin_available: true,
  },
  challenges: {
    done_today: 0,
    reset_date: new Date().toISOString().slice(0, 10),
    rewards_today: CHALLENGE_REWARDS,
    coins_earned_today: 0,
    total_coins_today: 181,
    daily_cap: 15,
  },
  user: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function apiUrl(path) {
  if (!API_BASE || API_BASE.includes("YOUR_SUBDOMAIN")) {
    throw new Error("Set APP_CONFIG.API_BASE in frontend/index.html to your Worker URL.");
  }
  return `${API_BASE}${path}`;
}

async function api(path, options = {}) {
  if (OFFLINE_DEMO) {
    return mockApi(path, options);
  }
  const response = await fetch(apiUrl(path), {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || "Request failed");
  }
  return data;
}

async function mockApi(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const body = options.body ? JSON.parse(options.body) : {};
  if (!mockState.user) {
    mockState.user = {
      tg_id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || "Demo",
      balance: 10,
      total_earned: 10,
      total_withdrawn: 0,
      referral_code: "DEMO50",
      referred_by: null,
      referral_count: 3,
      referral_earnings: 60,
      referral_bonus_paid: true,
      ads_today: { adsgram: 0, monetag: 0, date: new Date().toISOString().slice(0, 10) },
      level: "bronze",
      upi_id: "",
      welcome_bonus_given: true,
      created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      is_banned: false,
    };
  }
  if (path === "/api/register" || path.startsWith("/api/user/")) {
    return structuredClone(mockState.user);
  }
  if (path === "/api/ad-token") {
    return { token: crypto.randomUUID(), network: body.network, expires_at: new Date(Date.now() + 600000).toISOString() };
  }
  if (path.includes("-callback")) {
    return { success: true };
  }
  if (path === "/api/reward") {
    const watched = mockState.user.ads_today[body.network] || 0;
    if (watched >= 10) throw new Error("Daily network limit reached");
    mockState.user.ads_today[body.network] = watched + 1;
    mockState.user.balance += AD_REWARD_AMOUNT;
    mockState.user.total_earned += AD_REWARD_AMOUNT;
    return { success: true, new_balance: mockState.user.balance, level: mockState.user.level, ads_watched_for_network: watched + 1 };
  }
  if (path.startsWith("/api/tasks") && options.method !== "POST") {
    return { tasks: structuredClone(mockState.tasks) };
  }
  if (path.startsWith("/api/tasks/") && options.method === "POST") {
    const taskId = Number(path.split("/")[3]);
    const task = mockState.tasks.find((item) => item.id === taskId);
    if (!task || task.completed) throw new Error("Quest already claimed");
    task.completed = true;
    mockState.user.balance += 10;
    mockState.user.total_earned += 10;
    return { success: true, new_balance: mockState.user.balance };
  }
  if (path.startsWith("/api/withdrawals/")) {
    return { withdrawals: structuredClone(mockState.withdrawals) };
  }
  if (path.startsWith("/api/energy/") && options.method !== "POST") {
    return structuredClone(mockState.energy);
  }
  if (path === "/api/energy-boost") {
    if (mockState.energy.boosts_today >= ENERGY_BOOST_CAP) throw new Error("Max boosts reached for today");
    mockState.energy.energy = Math.min(ENERGY_MAX, mockState.energy.energy + 1);
    mockState.energy.boosts_today += 1;
    return { success: true, new_energy: mockState.energy.energy, boosts_left: ENERGY_BOOST_CAP - mockState.energy.boosts_today, ...structuredClone(mockState.energy) };
  }
  if (path === "/api/spin") {
    if (mockState.energy.spins_today >= SPIN_CAP) throw new Error("Daily spin limit reached");
    const useFreeSpin = body.free_spin && !mockState.energy.free_spin_used;
    if (!useFreeSpin && mockState.energy.energy <= 0) throw new Error("Watch a sponsor mission to unlock your next spin.");
    const segment = pickMockSpinSegment();
    const reward = segment.reward;
    if (useFreeSpin) {
      mockState.energy.free_spin_used = true;
      mockState.energy.free_spin_available = false;
    } else {
      mockState.energy.energy -= 1;
    }
    mockState.energy.spins_today += 1;
    mockState.energy.spins_left = SPIN_CAP - mockState.energy.spins_today;
    mockState.user.balance += reward;
    mockState.user.total_earned += reward;
    return { success: true, prize_coins: reward, reward, segment_id: segment.id, segment_label: segment.label, used_free_spin: useFreeSpin, new_balance: mockState.user.balance, energy_left: mockState.energy.energy, ...structuredClone(mockState.energy) };
  }
  if (path.startsWith("/api/challenges/") && options.method !== "POST") {
    return structuredClone(mockState.challenges);
  }
  if (path === "/api/challenge-complete") {
    if (mockState.challenges.done_today >= CHALLENGE_CAP) throw new Error("Come back tomorrow!");
    if (Number(body.slot) !== Number(mockState.challenges.done_today)) throw new Error("Complete challenges in order.");
    const reward = mockState.challenges.rewards_today[body.slot] || 5;
    mockState.challenges.done_today += 1;
    mockState.challenges.coins_earned_today = challengeEarnedToday(mockState.challenges.done_today);
    mockState.user.balance += reward;
    mockState.user.total_earned += reward;
    return { success: true, coins_earned: reward, reward, new_balance: mockState.user.balance, challenges_left: CHALLENGE_CAP - mockState.challenges.done_today, ...structuredClone(mockState.challenges) };
  }
  if (path === "/api/withdraw") {
    if (body.amount < 1000) throw new Error("Minimum withdrawal is 1000 coins");
    if (body.amount > mockState.user.balance) throw new Error("Insufficient balance");
    mockState.user.balance -= body.amount;
    mockState.user.total_withdrawn += body.amount;
    mockState.user.upi_id = body.upi_id;
    mockState.withdrawals.unshift({
      id: mockState.withdrawals.length + 1,
      upi_id: body.upi_id,
      amount: body.amount,
      payout_inr: payoutInr(body.amount),
      bonus_rupees: body.amount >= BONUS_WITHDRAWAL_COINS ? BONUS_WITHDRAWAL_RUPEES : 0,
      status: "pending",
      requested_at: new Date().toISOString(),
      processed_at: null,
    });
    return { success: true, new_balance: mockState.user.balance, payout_inr: payoutInr(body.amount), flagged: false };
  }
  throw new Error("Offline demo route not implemented");
}

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function payoutInr(coinsValue) {
  const coinAmount = Number(coinsValue || 0);
  const bonus = coinAmount >= BONUS_WITHDRAWAL_COINS ? BONUS_WITHDRAWAL_RUPEES : 0;
  return coinAmount / COINS_PER_RUPEE + bonus;
}

function coinValueInr(coinsValue) {
  return Number(coinsValue || 0) / COINS_PER_RUPEE;
}

function coins(value) {
  const amount = Number(value || 0);
  return Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
}

function rewardClass(value) {
  const reward = Number(value || 0);
  if (reward >= 500) return "reward-legendary";
  if (reward >= 100) return "reward-orange";
  if (reward >= 50) return "reward-purple";
  if (reward >= 20) return "reward-blue";
  if (reward >= 10) return "reward-green";
  return "reward-low";
}

function freeSpinKey() {
  return `${FREE_SPIN_PREFIX}${tgUser.id}`;
}

function localFreeSpinUsed() {
  return localStorage.getItem(freeSpinKey()) === "1";
}

function markLocalFreeSpinUsed() {
  localStorage.setItem(freeSpinKey(), "1");
}

function isFreeSpinAvailable() {
  return Boolean(state.energy?.free_spin_available) && !localFreeSpinUsed();
}

function challengeEarnedToday(doneToday) {
  return CHALLENGE_REWARDS.slice(0, Math.max(0, Math.min(Number(doneToday || 0), CHALLENGE_CAP))).reduce((sum, value) => sum + value, 0);
}

function pickMockSpinSegment() {
  const weighted = [
    { id: 2, reward: 100, weight: 3 },
    { id: 3, reward: 5, weight: 25 },
    { id: 4, reward: 50, weight: 5 },
    { id: 5, reward: 0, weight: 15 },
    { id: 6, reward: 20, weight: 8 },
    { id: 7, reward: 10, weight: 24 },
    { id: 8, reward: 5, weight: 20 },
  ];
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  return weighted.find((item) => {
    roll -= item.weight;
    return roll <= 0;
  }) || weighted[weighted.length - 1];
}

function showLoader(show, text = "Preparing mission...") {
  const loader = $("#loader");
  loader.hidden = !show;
  loader.querySelector("span").textContent = text;
}

function showToast(message = "⚡ +5 Coins Earned!") {
  const toast = $("#reward-toast");
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4200);
}

function userMessage(error, fallback = "Mission could not start. Please try again.") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.description || error.message || error.error || fallback;
}

function showAlert(message) {
  const safeMessage = String(message || "Something went wrong. Please try again.").slice(0, 180);
  if (tg?.showAlert) {
    try {
      tg.showAlert(safeMessage);
      return;
    } catch (error) {
      console.warn("Telegram alert failed", error);
    }
  }
  alert(safeMessage);
}

function setAvatar() {
  const avatar = $("#avatar");
  if (tgUser.photo_url) {
    avatar.src = tgUser.photo_url;
    return;
  }
  const name = encodeURIComponent(tgUser.first_name || "M");
  avatar.src = `https://api.dicebear.com/8.x/initials/svg?seed=${name}&backgroundColor=00c853&fontFamily=Inter`;
}

function channelLink(channelUsername) {
  return `https://t.me/${String(channelUsername || "").replace(/^@/, "")}`;
}

function openTaskChannel(channelUsername) {
  const link = channelLink(channelUsername);
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(link);
    return;
  }
  window.open(link, "_blank", "noopener,noreferrer");
}

function renderUser() {
  if (!state.user) return;
  $("#user-name").textContent = state.user.first_name || state.user.username || "MissionVault";
  $("#balance").textContent = `${coins(state.user.balance)} Coins`;
  $("#balance-rupee").textContent = `(= ${money(coinValueInr(state.user.balance))})`;
  $("#withdraw-balance").textContent = `${coins(state.user.balance)} Coins`;
  $("#ref-count").textContent = state.user.referral_count || 0;
  $("#ref-earned").textContent = `${coins(state.user.referral_earnings)} Coins`;
  renderWithdrawalBonus();
  renderLeaderboard();

  const botName = config.BOT_USERNAME || "Watch_and3arn_bot";
  const link = `https://t.me/${botName}?start=${state.user.referral_code}`;
  $("#referral-link").value = link;

}

function renderWithdrawalBonus() {
  if (!$("#bonus-progress-fill") || !state.user) return;
  const balance = Number(state.user.balance || 0);
  const progress = Math.max(0, Math.min(100, (balance / BONUS_WITHDRAWAL_COINS) * 100));
  $("#bonus-progress-fill").style.width = `${progress}%`;
  $("#bonus-progress-label").textContent = `${coins(Math.min(balance, BONUS_WITHDRAWAL_COINS))} / ${BONUS_WITHDRAWAL_COINS} coins`;
  $("#withdraw-now-btn").disabled = balance < MIN_WITHDRAWAL_COINS;
  $("#withdraw-bonus-btn").disabled = balance < BONUS_WITHDRAWAL_COINS;
}

function userLeaderboardSlot() {
  const id = Number(tgUser.id || 0);
  return 7 + (id % 5);
}

function medalForRank(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

function renderLeaderboard() {
  const list = $("#leaderboard-list");
  if (!list || !state.user) return;
  const userIndex = userLeaderboardSlot();
  const rows = FAKE_LEADERS.map((item) => ({ ...item, current: false }));
  rows[userIndex] = {
    name: state.user.username ? `@${state.user.username}` : state.user.first_name || "You",
    coins: Math.round(Number(state.user.total_earned || state.user.balance || 0)),
    withdrawn: coinValueInr(state.user.total_withdrawn || 0),
    current: true,
  };
  list.innerHTML = rows.map((row, index) => {
    const rank = index + 1;
    return `
      <article class="leader-row ${row.current ? "current-user" : ""} ${rank === 1 ? "rank-one" : ""}">
        <span class="leader-rank">${medalForRank(rank)}</span>
        <div>
          <strong>${row.name}</strong>
          <small>${Number(row.coins).toLocaleString("en-IN")} coins earned</small>
        </div>
        <em>${money(row.withdrawn)}</em>
      </article>
    `;
  }).join("");
}

function renderEnergy() {
  const energy = state.energy || { energy: 0, boosts_today: 0, boost_daily_cap: ENERGY_BOOST_CAP, spins_today: 0 };
  const spinsToday = Number(energy.spins_today || 0);
  if (energy.free_spin_used) markLocalFreeSpinUsed();
  const capped = spinsToday >= SPIN_CAP;
  const spinsLeft = Math.max(0, SPIN_CAP - spinsToday);
  $("#spin-status").textContent = capped ? "Come back tomorrow 🌙" : `🎰 ${spinsLeft} spins left today`;
  $("#spin-button").disabled = capped;
  $("#spin-button").textContent = capped ? "🌙 COME BACK TOMORROW" : "🎰 SPIN NOW";
}

function renderChallenges() {
  const challenges = state.challenges || { done_today: 0, daily_cap: CHALLENGE_CAP, rewards_today: [] };
  const done = Number(challenges.done_today || 0);
  const cap = Number(challenges.daily_cap || CHALLENGE_CAP);
  const earnedToday = Number(challenges.coins_earned_today ?? challengeEarnedToday(done));
  const totalToday = Number(challenges.total_coins_today || 181);
  $("#challenge-progress").textContent = done >= cap ? `Daily Complete! 🎉 · ${earnedToday} coins earned today` : `${done}/${cap} challenges done · ${earnedToday} coins earned today`;
  const banner = $("#challenge-banner");
  banner.hidden = done < cap;
  banner.textContent = `Daily Complete! 🎉 ${earnedToday}/${totalToday} coins collected`;
  $("#challenge-slots").innerHTML = (challenges.rewards_today || CHALLENGE_REWARDS).map((reward, index) => {
    const isCompleted = index < done;
    const isActive = index === done && done < cap;
    const progressText = isCompleted ? "✓ Completed" : isActive ? "Ready" : "Locked";
    const tier = index < 6 ? "easy" : index < 12 ? "medium" : index < 14 ? "hard" : "final";
    return `
    <button class="challenge-card ${rewardClass(reward)} challenge-${tier} ${isCompleted ? "completed" : ""} ${isActive ? "active" : "locked"}" type="button" data-challenge-slot="${index}" ${!isActive ? "disabled" : ""}>
      <span>${index === 14 ? "🔥 " : ""}Challenge ${index + 1}</span>
      <strong><i aria-hidden="true"></i>+${Number(reward || 0)} Coins</strong>
      <small>${progressText}</small>
    </button>
  `;
  }).join("");
}

function spinRotationForSegment(segmentId) {
  const segmentSize = 360 / SPIN_SEGMENTS.length;
  const centerAngle = (Number(segmentId || 1) - 0.5) * segmentSize;
  return state.wheelTurns * 1800 + (360 - centerAngle);
}

function teaseSegmentFor(result) {
  const reward = Number(result.prize_coins ?? result.reward ?? 0);
  if (reward === 0) return 4; // +50 tease before Better Luck.
  if (reward === 5 || reward === 10) return reward === 5 ? 2 : 4;
  return null;
}

function setWheelTransition(value) {
  $("#spin-wheel").style.transition = value;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateWheelResult(result) {
  const wheel = $("#spin-wheel");
  const teaseSegment = teaseSegmentFor(result);
  if (teaseSegment) {
    wheel.classList.add("tension");
    state.wheelTurns += 1;
    setWheelTransition("transform 1900ms cubic-bezier(0.08, 0.76, 0.12, 1)");
    wheel.style.transform = `rotate(${spinRotationForSegment(teaseSegment)}deg)`;
    await wait(1950);
    wheel.classList.add("slip");
    state.wheelTurns += 1;
    setWheelTransition("transform 720ms cubic-bezier(0.42, 0, 0.18, 1)");
    wheel.style.transform = `rotate(${spinRotationForSegment(result.segment_id)}deg)`;
    await wait(760);
    wheel.classList.remove("tension", "slip");
    setWheelTransition("");
  } else {
    wheel.classList.add("tension");
    state.wheelTurns += 1;
    setWheelTransition("transform 2400ms cubic-bezier(0.06, 0.72, 0.09, 1)");
    wheel.style.transform = `rotate(${spinRotationForSegment(result.segment_id)}deg)`;
    await wait(2450);
    wheel.classList.remove("tension");
    setWheelTransition("");
  }
  const reward = Number(result.prize_coins ?? result.reward ?? 0);
  $("#spin-result").textContent = reward > 0 ? `+${reward}` : "0";
}

function spinToastMessage(result) {
  const reward = Number(result.prize_coins ?? result.reward ?? 0);
  if (reward === 100) return "Lucky! 🎉 +100 Coins";
  if (reward === 0) return "Almost! Try again 🎰";
  if (reward === 5 || reward === 10) return "So close! +100 was just one step away 😭";
  return `🎰 ${reward} Coins Won!`;
}

function triggerConfetti() {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const colors = ["#ffd700", "#00c853", "#ffffff", "#ff8a00", "#35d3ff"];
  layer.innerHTML = Array.from({ length: 30 }, (_, index) => (
    `<span style="--x:${Math.random() * 220 - 110}px;--r:${Math.random() * 360}deg;--c:${colors[index % colors.length]}"></span>`
  )).join("");
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}

function switchScreen(screen, options = {}) {
  const nextScreen = VALID_SCREENS.has(screen) ? screen : "home";
  state.activeScreen = nextScreen;
  if (options.updateHash !== false && !location.hash.includes("tgWebAppData")) {
    history.replaceState(null, "", `#${nextScreen}`);
  }
  $$(".screen").forEach((node) => node.classList.toggle("active", node.dataset.screen === nextScreen));
  $$(".nav-btn").forEach((node) => node.classList.toggle("active", node.dataset.target === nextScreen));
  if (nextScreen === "home") {
    if (state.user) loadEnergy();
  }
  if (nextScreen === "challenge") {
    loadTasks();
    if (state.user) loadChallenges();
  }
  if (nextScreen === "leaderboard") renderLeaderboard();
  if (nextScreen === "withdraw") loadWithdrawals();
}

async function register() {
  state.user = await api("/api/register", {
    method: "POST",
    body: JSON.stringify({
      tg_id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      referral_code: startParam || null,
    }),
  });
  renderUser();
  await loadChallenges();
  await loadEnergy();
}

async function refreshUser() {
  state.user = await api(`/api/user/${tgUser.id}`);
  renderUser();
}

async function loadEnergy() {
  try {
    state.energy = await api(`/api/energy/${tgUser.id}`);
    renderEnergy();
  } catch (error) {
    $("#spin-status").textContent = error.message;
  }
}

async function loadChallenges() {
  try {
    state.challenges = await api(`/api/challenges/${tgUser.id}`);
    renderChallenges();
  } catch (error) {
    $("#challenge-progress").textContent = error.message;
  }
}

async function runDemoCallback(network, token) {
  if (network === "adsgram") {
    return api("/api/adsgram-callback", {
      method: "POST",
      body: JSON.stringify({ token, userId: tgUser.id }),
    });
  }
  if (network === "monetag") {
    return api(`/api/monetag-callback?token=${encodeURIComponent(token)}`, { method: "POST" });
  }
  throw new Error("Unsupported mission.");
}

async function showAdsgramAd() {
  const blockId = window.ADSGRAM_BLOCK_ID || config.ADSGRAM_BLOCK_ID;
  if (!blockId) {
    throw new Error("Mission provider ID is missing.");
  }
  if (!window.Adsgram?.init) {
    throw new Error("Mission provider is not loaded. Open MissionVault inside Telegram and try again.");
  }
  const controller = window.Adsgram.init({ blockId });
  try {
    const result = await controller.show();
    if (result && result.error) {
      throw result;
    }
    return result;
  } catch (error) {
    throw new Error(userMessage(error, "No sponsor mission available right now."));
  } finally {
    try {
      controller.destroy?.();
    } catch (error) {
      console.warn("Adsgram cleanup failed", error);
    }
  }
}

async function showMonetagAd(token, requestVar = "home_monetag_button") {
  const zoneId = window.MONETAG_ZONE_ID || config.MONETAG_ZONE_ID;
  const sdkFn = config.MONETAG_SDK_FN || `show_${zoneId}`;
  const showAd = window[sdkFn];
  if (typeof showAd !== "function") {
    throw new Error("Mission provider is not loaded. Open MissionVault inside Telegram and try again.");
  }
  await showAd({
    ymid: token,
    requestVar,
  });
}

async function runNetworkAd(network, token) {
  showLoader(true, "Starting mission...");
  if (network === "adsgram" && !OFFLINE_DEMO) {
    await showAdsgramAd();
  } else if (network === "monetag" && !OFFLINE_DEMO) {
    await showMonetagAd(token);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  if (DEMO_AD_CALLBACKS) {
    await runDemoCallback(network, token);
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function watchAd(network) {
  try {
    const tokenData = await api("/api/ad-token", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, network }),
    });
    await runNetworkAd(network, tokenData.token);
    const reward = await api("/api/reward", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, network, token: tokenData.token }),
    });
    await refreshUser();
    showToast(reward.ads_watched_for_network >= 10 ? "⚡ +5 Coins Earned! Daily limit reached" : "⚡ +5 Coins Earned!");
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

async function spinWheel() {
  try {
    if (state.energy && Number(state.energy.spins_today || 0) >= Number(state.energy.spin_daily_cap || SPIN_CAP)) {
      showAlert("Come back tomorrow 🌙");
      return;
    }
    const useFreeSpin = isFreeSpinAvailable();
    const hasEnergy = Number(state.energy?.energy || 0) > 0;
    if (!useFreeSpin && !hasEnergy) {
      const unlocked = await earnSpinEnergy({ showResultToast: false });
      if (!unlocked) return;
    }
    const result = await api("/api/spin", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, free_spin: useFreeSpin }),
    });
    if (result.used_free_spin || useFreeSpin) markLocalFreeSpinUsed();
    state.energy = result;
    renderEnergy();
    await animateWheelResult(result);
    await refreshUser();
    if (Number(result.prize_coins || 0) === 100) triggerConfetti();
    showToast(spinToastMessage(result));
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

async function earnSpinEnergy({ showResultToast = true } = {}) {
  try {
    if (state.energy && Number(state.energy.boosts_today || 0) >= Number(state.energy.boost_daily_cap || ENERGY_BOOST_CAP)) {
      showAlert("Max boosts reached for today");
      return null;
    }
    showLoader(true, "Starting sponsor mission...");
    const tokenData = await api("/api/ad-token", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, network: "adsgram" }),
    });
    if (!OFFLINE_DEMO) {
      await showAdsgramAd();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    if (DEMO_AD_CALLBACKS) {
      await runDemoCallback("adsgram", tokenData.token);
    }
    const result = await api("/api/energy-boost", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, token: tokenData.token }),
    });
    state.energy = result;
    renderEnergy();
    if (showResultToast) showToast("+1 Spin Unlocked!");
    return result;
  } catch (error) {
    showAlert(error.message);
    return null;
  } finally {
    showLoader(false);
  }
}

async function boostEnergy() {
  await earnSpinEnergy();
}

async function completeChallenge(slot) {
  try {
    if (state.challenges && Number(state.challenges.done_today || 0) >= Number(state.challenges.daily_cap || CHALLENGE_CAP)) {
      showAlert("Come back tomorrow!");
      return;
    }
    showLoader(true, "Opening challenge...");
    const tokenData = await api("/api/ad-token", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, network: "monetag" }),
    });
    if (!OFFLINE_DEMO) {
      await showMonetagAd(tokenData.token, "daily_challenge");
    } else {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    if (DEMO_AD_CALLBACKS) {
      await runDemoCallback("monetag", tokenData.token);
    }
    const result = await api("/api/challenge-complete", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, token: tokenData.token, slot: Number(slot) }),
    });
    state.challenges = result;
    renderChallenges();
    await refreshUser();
    if (Number(result.done_today || 0) === 14) {
      showToast("One more! +50 coins waiting 🔥");
    } else if (Number(result.done_today || 0) >= CHALLENGE_CAP) {
      showToast(`Daily Complete! 🎉 ${result.coins_earned_today} coins earned`);
    } else {
      showToast(`🎯 Challenge Complete! +${result.coins_earned} Coins`);
    }
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

async function loadTasks() {
  const list = $("#task-list");
  list.innerHTML = '<p class="form-note">Loading quests...</p>';
  try {
    const data = await api(`/api/tasks?tg_id=${tgUser.id}`);
    const unpaidTasks = data.tasks.filter((task) => !task.completed);
    list.innerHTML = unpaidTasks.map((task) => `
      <article class="task-row">
        <div>
          <strong>${task.channel_name}</strong><br />
          <span>${task.channel_username}</span>
          <small> · +${Number(task.reward_amount).toFixed(0)} Coins reward</small>
        </div>
        <div class="task-actions">
          <button type="button" data-task-link="${task.channel_username}">Join</button>
          <button type="button" data-task-id="${task.id}">Verify</button>
        </div>
      </article>
    `).join("") || '<p class="form-note">No active quests right now.</p>';
  } catch (error) {
    list.innerHTML = `<p class="form-note">${error.message}</p>`;
  }
}

async function verifyTask(taskId) {
  try {
    showLoader(true, "Verifying quest...");
    await api(`/api/tasks/${taskId}/verify`, {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id }),
    });
    await refreshUser();
    await loadTasks();
    showToast("⚡ +10 Coins Earned!");
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

async function loadWithdrawals() {
  const list = $("#withdraw-history");
  list.innerHTML = '<p class="form-note">Loading history...</p>';
  try {
    const data = await api(`/api/withdrawals/${tgUser.id}`);
    list.innerHTML = data.withdrawals.map((item) => `
      <article class="history-item">
        <div>
          <strong>${coins(item.amount)} coins → ${money(item.payout_inr ?? payoutInr(item.amount))}</strong><br />
          <small>${new Date(item.requested_at).toLocaleDateString()}</small>
        </div>
        <span class="status ${item.status}">${item.status}</span>
      </article>
    `).join("") || '<p class="form-note">No withdrawals yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="form-note">${error.message}</p>`;
  }
}

async function submitWithdraw() {
  const upi = $("#upi-id").value.trim();
  const amount = Number($("#withdraw-amount").value);
  if (!upi || !amount) {
    showAlert("Enter UPI ID and amount.");
    return;
  }
  if (amount < MIN_WITHDRAWAL_COINS) {
    showAlert("Minimum withdrawal is 1000 coins.");
    return;
  }
  try {
    showLoader(true, "Submitting withdrawal...");
    const result = await api("/api/withdraw", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, upi_id: upi, amount }),
    });
    $("#withdraw-amount").value = "";
    await refreshUser();
    await loadWithdrawals();
    const payout = result.payout_inr ?? payoutInr(amount);
    showToast(result.admin_warning || `Withdrawal request pending admin review · ${money(payout)}`);
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

function chooseWithdrawAmount(amount) {
  $("#withdraw-amount").value = String(amount);
  if (amount >= BONUS_WITHDRAWAL_COINS) {
    showToast("Bonus payout selected: 2000 coins → ₹1050");
  } else {
    showToast("Minimum payout selected: 1000 coins → ₹500");
  }
}

function bindEvents() {
  $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchScreen(btn.dataset.target)));
  $$(".ad-card").forEach((btn) => btn.addEventListener("click", () => watchAd(btn.dataset.network)));
  $("#refresh-btn").addEventListener("click", () => refreshUser().catch((error) => showAlert(error.message)));
  $("#toast-action").addEventListener("click", () => document.querySelector(".ad-card:not([disabled])")?.click());
  $("#spin-button").addEventListener("click", spinWheel);
  $("#challenge-slots").addEventListener("click", (event) => {
    const challenge = event.target.closest("button[data-challenge-slot]");
    if (challenge && !challenge.disabled) completeChallenge(challenge.dataset.challengeSlot);
  });
  $("#task-list").addEventListener("click", (event) => {
    const joinButton = event.target.closest("button[data-task-link]");
    if (joinButton && !joinButton.disabled) {
      openTaskChannel(joinButton.dataset.taskLink);
      return;
    }
    const verifyButton = event.target.closest("button[data-task-id]");
    if (verifyButton && !verifyButton.disabled) verifyTask(verifyButton.dataset.taskId);
  });
  $("#copy-referral").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#referral-link").value);
    showToast("Referral link copied");
  });
  $("#withdraw-now-btn").addEventListener("click", () => chooseWithdrawAmount(MIN_WITHDRAWAL_COINS));
  $("#withdraw-bonus-btn").addEventListener("click", () => chooseWithdrawAmount(BONUS_WITHDRAWAL_COINS));
  $("#submit-withdraw").addEventListener("click", submitWithdraw);
}

async function boot() {
  setAvatar();
  bindEvents();
  switchScreen(state.activeScreen, { updateHash: false });
  try {
    await register();
  } catch (error) {
    showAlert(error.message);
  }
}

boot();
