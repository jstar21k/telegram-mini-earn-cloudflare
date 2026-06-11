CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  total_earned_paise INTEGER NOT NULL DEFAULT 0,
  total_withdrawn_paise INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER,
  referral_count INTEGER NOT NULL DEFAULT 0,
  referral_earnings_paise INTEGER NOT NULL DEFAULT 0,
  streak_count INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  streak_bonus_claimed TEXT NOT NULL DEFAULT '[]',
  level TEXT NOT NULL DEFAULT 'bronze' CHECK (level IN ('bronze', 'silver', 'gold')),
  upi_id TEXT,
  welcome_bonus_given INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  is_banned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_users_upi_id ON users(upi_id);

CREATE TABLE IF NOT EXISTS daily_ad_counts (
  tg_id INTEGER NOT NULL,
  activity_date TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('adsgram', 'monetag', 'propeller')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tg_id, activity_date, network),
  FOREIGN KEY (tg_id) REFERENCES users(tg_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  network TEXT,
  timestamp TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (tg_id) REFERENCES users(tg_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_tg_id ON transactions(tg_id);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  upi_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (tg_id) REFERENCES users(tg_id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_tg_id ON withdrawals(tg_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

CREATE TABLE IF NOT EXISTS ad_tokens (
  token TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('adsgram', 'monetag', 'propeller')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  FOREIGN KEY (tg_id) REFERENCES users(tg_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_tokens_user_network ON ad_tokens(tg_id, network);
CREATE INDEX IF NOT EXISTS idx_ad_tokens_expires_at ON ad_tokens(expires_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_username TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  reward_paise INTEGER NOT NULL DEFAULT 1000,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  UNIQUE(tg_id, task_id),
  FOREIGN KEY (tg_id) REFERENCES users(tg_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

INSERT INTO tasks (channel_username, channel_name, reward_paise, active)
SELECT '@open_link_and_earn', 'Update Channel', 1000, 1
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE channel_username = '@open_link_and_earn');

INSERT INTO tasks (channel_username, channel_name, reward_paise, active)
SELECT '@link69_viral', 'Partner / Sponsor', 1000, 1
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE channel_username = '@link69_viral');
