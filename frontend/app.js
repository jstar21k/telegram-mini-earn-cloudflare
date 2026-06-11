const config = window.APP_CONFIG || {};
const API_BASE = (config.API_BASE || "").replace(/\/$/, "");
const OFFLINE_DEMO = !API_BASE || API_BASE.includes("YOUR_SUBDOMAIN");
const DEMO_AD_CALLBACKS = Boolean(config.DEMO_AD_CALLBACKS);
const adControllers = {};
const AD_REWARD_AMOUNT = 5;
const ENERGY_MAX = 10;
const ENERGY_BOOST_CAP = 15;
const SPIN_CAP = 15;
const CHALLENGE_CAP = 15;
const SPIN_SEGMENTS = [
  { id: 1, reward: 5 },
  { id: 2, reward: 5 },
  { id: 3, reward: 10 },
  { id: 4, reward: 20 },
  { id: 5, reward: 20 },
  { id: 6, reward: 50 },
  { id: 7, reward: 100 },
  { id: 8, reward: 500 },
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
const VALID_SCREENS = new Set(["home", "challenge", "refer", "withdraw"]);

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
    energy: 10,
    boosts_today: 0,
    reset_date: new Date().toISOString().slice(0, 10),
    max_energy: 10,
    boost_daily_cap: 15,
    spins_today: 0,
    spins_left: 15,
  },
  challenges: {
    done_today: 0,
    reset_date: new Date().toISOString().slice(0, 10),
    rewards_today: [5, 10, 15, 20, 5, 10, 15, 20, 5, 10, 15, 20, 5, 10, 15],
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
      balance: 25,
      total_earned: 25,
      total_withdrawn: 0,
      referral_code: "DEMO50",
      referred_by: null,
      referral_count: 3,
      referral_earnings: 10,
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
    mockState.energy.energy = Math.min(ENERGY_MAX, mockState.energy.energy + 2);
    mockState.energy.boosts_today += 1;
    return { success: true, new_energy: mockState.energy.energy, boosts_left: ENERGY_BOOST_CAP - mockState.energy.boosts_today, ...structuredClone(mockState.energy) };
  }
  if (path === "/api/spin") {
    if (mockState.energy.energy <= 0) throw new Error("No energy left. Boost energy to spin again.");
    if (mockState.energy.spins_today >= SPIN_CAP) throw new Error("Daily spin limit reached");
    const segment = SPIN_SEGMENTS[Math.floor(Math.random() * SPIN_SEGMENTS.length)];
    const reward = segment.reward;
    mockState.energy.energy -= 1;
    mockState.energy.spins_today += 1;
    mockState.energy.spins_left = SPIN_CAP - mockState.energy.spins_today;
    mockState.user.balance += reward;
    mockState.user.total_earned += reward;
    return { success: true, prize_coins: reward, reward, segment_id: segment.id, new_balance: mockState.user.balance, energy_left: mockState.energy.energy, ...structuredClone(mockState.energy) };
  }
  if (path.startsWith("/api/challenges/") && options.method !== "POST") {
    return structuredClone(mockState.challenges);
  }
  if (path === "/api/challenge-complete") {
    if (mockState.challenges.done_today >= CHALLENGE_CAP) throw new Error("Come back tomorrow!");
    const reward = mockState.challenges.rewards_today[body.slot] || 5;
    mockState.challenges.done_today += 1;
    mockState.user.balance += reward;
    mockState.user.total_earned += reward;
    return { success: true, coins_earned: reward, reward, new_balance: mockState.user.balance, challenges_left: CHALLENGE_CAP - mockState.challenges.done_today, ...structuredClone(mockState.challenges) };
  }
  if (path === "/api/withdraw") {
    if (body.amount < 400) throw new Error("Minimum withdrawal is ₹400");
    if (body.amount > mockState.user.balance) throw new Error("Insufficient balance");
    mockState.user.balance -= body.amount;
    mockState.user.total_withdrawn += body.amount;
    mockState.user.upi_id = body.upi_id;
    mockState.withdrawals.unshift({
      id: mockState.withdrawals.length + 1,
      upi_id: body.upi_id,
      amount: body.amount,
      status: "pending",
      requested_at: new Date().toISOString(),
      processed_at: null,
    });
    return { success: true, new_balance: mockState.user.balance, flagged: false };
  }
  throw new Error("Offline demo route not implemented");
}

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
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

function showAlert(message) {
  if (tg?.showAlert) {
    tg.showAlert(message);
  } else {
    alert(message);
  }
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
  $("#balance-rupee").textContent = `(= ${money(state.user.balance)})`;
  $("#withdraw-balance").textContent = money(state.user.balance);
  $("#ref-count").textContent = state.user.referral_count || 0;
  $("#ref-earned").textContent = `${coins(state.user.referral_earnings)} Coins`;

  const botName = config.BOT_USERNAME || "Watch_and3arn_bot";
  const link = `https://t.me/${botName}?start=${state.user.referral_code}`;
  $("#referral-link").value = link;

}

function renderEnergy() {
  const energy = state.energy || { energy: 0, boosts_today: 0, boost_daily_cap: ENERGY_BOOST_CAP, spins_today: 0 };
  const energyLeft = Math.max(0, Math.min(ENERGY_MAX, Number(energy.energy || 0)));
  const spinsToday = Number(energy.spins_today || 0);
  const boostCap = Number(energy.boost_daily_cap || ENERGY_BOOST_CAP);
  const boostsToday = Number(energy.boosts_today || 0);
  $("#spin-status").textContent = energyLeft > 0 ? "Server-picked rewards. Wheel lands on your prize." : "No energy left. Boost to keep spinning.";
  $("#energy-label").textContent = `⚡ ${energyLeft}/${ENERGY_MAX} Energy left`;
  $("#spins-label").textContent = `🔄 ${spinsToday}/${SPIN_CAP} spins today`;
  $("#energy-fill").style.width = `${(energyLeft / ENERGY_MAX) * 100}%`;
  $("#boost-count").textContent = `🚀 ${boostsToday}/${boostCap} Boosts`;
  $("#spin-button").disabled = energyLeft <= 0 || spinsToday >= SPIN_CAP;
}

function renderChallenges() {
  const challenges = state.challenges || { done_today: 0, daily_cap: CHALLENGE_CAP, rewards_today: [] };
  const done = Number(challenges.done_today || 0);
  const cap = Number(challenges.daily_cap || CHALLENGE_CAP);
  $("#challenge-progress").textContent = done >= cap ? "Come back tomorrow!" : `${done}/${cap} challenges done today`;
  $("#challenge-slots").innerHTML = (challenges.rewards_today || []).map((reward, index) => {
    const progressText = index < done ? "Completed" : "Ready";
    return `
    <button class="challenge-card ${rewardClass(reward)}" type="button" data-challenge-slot="${index}" ${done >= cap || index < done ? "disabled" : ""}>
      <span>Challenge ${index + 1}</span>
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
  adControllers.adsgram ||= window.Adsgram.init({ blockId });
  await adControllers.adsgram.show();
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
    const result = await api("/api/spin", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id }),
    });
    state.energy = result;
    renderEnergy();
    state.wheelTurns += 1;
    $("#spin-wheel").style.transform = `rotate(${spinRotationForSegment(result.segment_id)}deg)`;
    $("#spin-result").textContent = `+${result.prize_coins}`;
    await refreshUser();
    showToast(`🎰 ${result.prize_coins} Coins Won!`);
  } catch (error) {
    showAlert(error.message);
  }
}

async function boostEnergy() {
  try {
    if (state.energy && Number(state.energy.boosts_today || 0) >= Number(state.energy.boost_daily_cap || ENERGY_BOOST_CAP)) {
      showAlert("Max boosts reached for today");
      return;
    }
    showLoader(true, "Charging energy...");
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
    showToast("+2 Energy Added!");
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
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
    showToast(`🎯 Challenge Complete! +${result.coins_earned} Coins`);
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
          <strong>${money(item.amount)}</strong><br />
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
  try {
    showLoader(true, "Submitting withdrawal...");
    const result = await api("/api/withdraw", {
      method: "POST",
      body: JSON.stringify({ tg_id: tgUser.id, upi_id: upi, amount }),
    });
    $("#withdraw-amount").value = "";
    await refreshUser();
    await loadWithdrawals();
    showToast(result.admin_warning || "Withdrawal request pending admin review");
  } catch (error) {
    showAlert(error.message);
  } finally {
    showLoader(false);
  }
}

function bindEvents() {
  $$(".nav-btn").forEach((btn) => btn.addEventListener("click", () => switchScreen(btn.dataset.target)));
  $$(".ad-card").forEach((btn) => btn.addEventListener("click", () => watchAd(btn.dataset.network)));
  $("#refresh-btn").addEventListener("click", () => refreshUser().catch((error) => showAlert(error.message)));
  $("#toast-action").addEventListener("click", () => document.querySelector(".ad-card:not([disabled])")?.click());
  $("#spin-button").addEventListener("click", spinWheel);
  $("#boost-energy").addEventListener("click", boostEnergy);
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
