from __future__ import annotations

import hashlib
import hmac
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

try:
    from workers import WorkerEntrypoint
    import asgi
except Exception:  # Allows local syntax checks outside the Workers runtime.
    class WorkerEntrypoint:  # type: ignore
        pass

    asgi = None  # type: ignore

try:
    from js import fetch  # type: ignore
except Exception:
    fetch = None  # type: ignore

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


IST = timezone(timedelta(hours=5, minutes=30))
WELCOME_BONUS = 2_500
REFERRAL_JOIN_BONUS = 1_000
REFERRAL_AD_EARN_THRESHOLD = 5_000
AD_REWARD = 500
TASK_DEFAULT_REWARD = 1_000
MIN_WITHDRAWAL = 50_000
TOKEN_TTL_MINUTES = 10
NETWORKS = {"adsgram", "monetag"}
ENERGY_MAX = 10
ENERGY_BOOST_DAILY_CAP = 15
ENERGY_PER_BOOST = 2
CHALLENGE_DAILY_CAP = 15
CHALLENGE_REWARDS = [5, 10, 15, 20]
CHALLENGE_SLOTS = 3
SPIN_REWARDS = [5, 10, 15, 20]


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        if asgi is None:
            raise RuntimeError("asgi is only available inside Cloudflare Workers")
        return await asgi.fetch(app, request, self.env)


app = FastAPI(title="Telegram Mini Earn API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterBody(BaseModel):
    tg_id: int
    username: str | None = None
    first_name: str | None = None
    referral_code: str | None = None


class AdTokenBody(BaseModel):
    tg_id: int
    network: Literal["adsgram", "monetag"]


class RewardBody(BaseModel):
    tg_id: int
    network: Literal["adsgram", "monetag"]
    token: str


class WithdrawBody(BaseModel):
    tg_id: int
    upi_id: str = Field(min_length=3, max_length=100)
    amount: float = Field(gt=0)


class TaskVerifyBody(BaseModel):
    tg_id: int


class EnergyActionBody(BaseModel):
    tg_id: int


class ChallengeCompleteBody(BaseModel):
    tg_id: int
    slot: int = Field(ge=0, lt=CHALLENGE_SLOTS)


def withdrawal_action_callback(action: str, withdrawal_id: int) -> str:
    return f"withdraw:{action}:{withdrawal_id}"


def now_ist() -> datetime:
    return datetime.now(IST)


def iso_now() -> str:
    return now_ist().isoformat()


def today_ist() -> str:
    return now_ist().date().isoformat()


def paise_to_rupees(paise: int | None) -> float:
    return round((paise or 0) / 100, 2)


def rupees_to_paise(amount: float) -> int:
    return int(round(amount * 100))


def optional_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def to_py(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "to_py"):
        return value.to_py()
    return value


def clean_d1_nulls(value: Any) -> Any:
    if isinstance(value, dict):
        if not value:
            return None
        return {key: clean_d1_nulls(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_d1_nulls(item) for item in value]
    return value


def env_value(env: Any, key: str, default: str = "") -> str:
    if isinstance(env, dict):
        return str(env.get(key, default) or default)
    return str(getattr(env, key, default) or default)


def db_from_request(req: Request):
    env = req.scope["env"]
    return env.DB


def kv_from_request(req: Request):
    env = req.scope["env"]
    kv = getattr(env, "MISSION_KV", None)
    if kv is None:
        raise HTTPException(status_code=500, detail="Mission KV storage is not configured")
    return kv


async def kv_get_json(kv: Any, key: str) -> dict[str, Any] | None:
    value = to_py(await kv.get(key))
    if not value:
        return None
    if isinstance(value, dict):
        return value
    return json.loads(str(value))


async def kv_put_json(kv: Any, key: str, value: dict[str, Any]) -> None:
    await kv.put(key, json.dumps(value, separators=(",", ":")))


def daily_rewards_for(tg_id: int, date: str) -> list[int]:
    seed = int(hashlib.sha256(f"{tg_id}:{date}:challenges".encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    return [rng.choice(CHALLENGE_REWARDS) for _ in range(CHALLENGE_SLOTS)]


async def energy_state(kv: Any, tg_id: int) -> dict[str, Any]:
    key = f"energy:{tg_id}"
    date = today_ist()
    state = await kv_get_json(kv, key) or {"energy": ENERGY_MAX, "boosts_today": 0, "reset_date": date}
    if state.get("reset_date") != date:
        state["boosts_today"] = 0
        state["reset_date"] = date
        await kv_put_json(kv, key, state)
    state["energy"] = max(0, min(ENERGY_MAX, int(state.get("energy") or 0)))
    state["boosts_today"] = int(state.get("boosts_today") or 0)
    return state


async def save_energy_state(kv: Any, tg_id: int, state: dict[str, Any]) -> None:
    await kv_put_json(kv, f"energy:{tg_id}", state)


async def challenge_state(kv: Any, tg_id: int) -> dict[str, Any]:
    key = f"challenges:{tg_id}"
    date = today_ist()
    state = await kv_get_json(kv, key) or {
        "done_today": 0,
        "reset_date": date,
        "rewards_today": daily_rewards_for(tg_id, date),
    }
    if state.get("reset_date") != date:
        state = {
            "done_today": 0,
            "reset_date": date,
            "rewards_today": daily_rewards_for(tg_id, date),
        }
        await kv_put_json(kv, key, state)
    rewards = state.get("rewards_today")
    if not isinstance(rewards, list) or len(rewards) != CHALLENGE_SLOTS:
        state["rewards_today"] = daily_rewards_for(tg_id, date)
        await kv_put_json(kv, key, state)
    state["done_today"] = int(state.get("done_today") or 0)
    return state


async def save_challenge_state(kv: Any, tg_id: int, state: dict[str, Any]) -> None:
    await kv_put_json(kv, f"challenges:{tg_id}", state)


async def spin_state(kv: Any, tg_id: int) -> dict[str, Any]:
    key = f"spin:{tg_id}"
    date = today_ist()
    state = await kv_get_json(kv, key) or {"spins_today": 0, "reset_date": date}
    if state.get("reset_date") != date:
        state["spins_today"] = 0
        state["reset_date"] = date
        await kv_put_json(kv, key, state)
    state["spins_today"] = int(state.get("spins_today") or 0)
    return state


async def save_spin_state(kv: Any, tg_id: int, state: dict[str, Any]) -> None:
    await kv_put_json(kv, f"spin:{tg_id}", state)


async def d1_first(db: Any, sql: str, *params: Any) -> dict[str, Any] | None:
    stmt = db.prepare(sql)
    if params:
        stmt = stmt.bind(*params)
    row = clean_d1_nulls(to_py(await stmt.first()))
    return row or None


async def d1_all(db: Any, sql: str, *params: Any) -> list[dict[str, Any]]:
    stmt = db.prepare(sql)
    if params:
        stmt = stmt.bind(*params)
    result = await stmt.run()
    rows = clean_d1_nulls(to_py(result.results))
    return rows or []


async def d1_run(db: Any, sql: str, *params: Any) -> Any:
    stmt = db.prepare(sql)
    if params:
        stmt = stmt.bind(*params)
    return await stmt.run()


def d1_changes(result: Any) -> int:
    data = to_py(result) or {}
    return int(((data.get("meta") or {}).get("changes")) or 0)


async def add_transaction(
    db: Any,
    tg_id: int,
    tx_type: str,
    amount_paise: int,
    description: str,
    network: str | None = None,
) -> None:
    if network is None:
        await d1_run(
            db,
            """
            INSERT INTO transactions (tg_id, type, amount_paise, network, timestamp, description)
            VALUES (?, ?, ?, NULL, ?, ?)
            """,
            tg_id,
            tx_type,
            amount_paise,
            iso_now(),
            description,
        )
    else:
        await d1_run(
            db,
            """
            INSERT INTO transactions (tg_id, type, amount_paise, network, timestamp, description)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            tg_id,
            tx_type,
            amount_paise,
            network,
            iso_now(),
            description,
        )


async def generate_referral_code(db: Any) -> str:
    for _ in range(12):
        code = uuid.uuid4().hex[:6].upper()
        existing = await d1_first(db, "SELECT tg_id FROM users WHERE referral_code = ?", code)
        if not existing:
            return code
    raise HTTPException(status_code=500, detail="Could not generate referral code")


def calc_level(total_earned_paise: int) -> str:
    if total_earned_paise >= 200_000:
        return "gold"
    if total_earned_paise >= 50_000:
        return "silver"
    return "bronze"


def should_unlock_referral_bonus(user: dict[str, Any], ad_earned_paise: int) -> bool:
    return (
        optional_int(user.get("referred_by")) is not None
        and not int(user.get("referral_bonus_paid") or 0)
        and ad_earned_paise >= REFERRAL_AD_EARN_THRESHOLD
    )


async def update_level(db: Any, tg_id: int) -> str:
    user = await d1_first(db, "SELECT total_earned_paise FROM users WHERE tg_id = ?", tg_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    level = calc_level(int(user["total_earned_paise"] or 0))
    await d1_run(db, "UPDATE users SET level = ? WHERE tg_id = ?", level, tg_id)
    return level


async def get_user_or_404(db: Any, tg_id: int) -> dict[str, Any]:
    user = await d1_first(db, "SELECT * FROM users WHERE tg_id = ?", tg_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if int(user.get("is_banned") or 0):
        raise HTTPException(status_code=403, detail="User is banned")
    return user


async def serialize_user(db: Any, user: dict[str, Any]) -> dict[str, Any]:
    date = today_ist()
    counts = await d1_all(
        db,
        "SELECT network, count FROM daily_ad_counts WHERE tg_id = ? AND activity_date = ?",
        user["tg_id"],
        date,
    )
    ads_today = {"adsgram": 0, "monetag": 0, "date": date}
    for row in counts:
        ads_today[row["network"]] = int(row["count"] or 0)
    return {
        "tg_id": user["tg_id"],
        "username": user.get("username"),
        "first_name": user.get("first_name"),
        "balance": paise_to_rupees(user.get("balance_paise")),
        "total_earned": paise_to_rupees(user.get("total_earned_paise")),
        "total_withdrawn": paise_to_rupees(user.get("total_withdrawn_paise")),
        "referral_code": user.get("referral_code"),
        "referred_by": optional_int(user.get("referred_by")),
        "referral_count": int(user.get("referral_count") or 0),
        "referral_earnings": paise_to_rupees(user.get("referral_earnings_paise")),
        "referral_bonus_paid": bool(user.get("referral_bonus_paid", 1)),
        "ads_today": ads_today,
        "streak_count": int(user.get("streak_count") or 0),
        "last_active_date": optional_str(user.get("last_active_date")),
        "streak_bonus_claimed": json.loads(user.get("streak_bonus_claimed") or "[]"),
        "level": user.get("level") or "bronze",
        "upi_id": optional_str(user.get("upi_id")),
        "welcome_bonus_given": bool(user.get("welcome_bonus_given")),
        "created_at": user.get("created_at"),
        "is_banned": bool(user.get("is_banned")),
    }


async def register_user(db: Any, body: RegisterBody) -> dict[str, Any]:
    existing = await d1_first(db, "SELECT * FROM users WHERE tg_id = ?", body.tg_id)
    if existing:
        await d1_run(
            db,
            "UPDATE users SET username = ?, first_name = ? WHERE tg_id = ?",
            body.username or "",
            body.first_name or "",
            body.tg_id,
        )
        existing = await d1_first(db, "SELECT * FROM users WHERE tg_id = ?", body.tg_id)
        return await serialize_user(db, existing)

    referrer = None
    if body.referral_code:
        referrer = await d1_first(
            db,
            "SELECT tg_id FROM users WHERE referral_code = ?",
            body.referral_code.strip().upper(),
        )

    code = await generate_referral_code(db)
    created = iso_now()
    if referrer:
        await d1_run(
            db,
            """
            INSERT INTO users (
                tg_id, username, first_name, balance_paise, total_earned_paise,
                referral_code, referred_by, streak_bonus_claimed, level,
                referral_bonus_paid, welcome_bonus_given, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
            """,
            body.tg_id,
            body.username or "",
            body.first_name or "",
            WELCOME_BONUS,
            WELCOME_BONUS,
            code,
            referrer["tg_id"],
            "[]",
            "bronze",
            created,
        )
    else:
        await d1_run(
            db,
            """
            INSERT INTO users (
                tg_id, username, first_name, balance_paise, total_earned_paise,
                referral_code, referred_by, streak_bonus_claimed, level,
                welcome_bonus_given, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?)
            """,
            body.tg_id,
            body.username or "",
            body.first_name or "",
            WELCOME_BONUS,
            WELCOME_BONUS,
            code,
            "[]",
            "bronze",
            created,
        )
    await add_transaction(db, body.tg_id, "welcome_bonus", WELCOME_BONUS, "One-time welcome bonus")

    if referrer:
        await d1_run(
            db,
            """
            UPDATE users
            SET referral_count = referral_count + 1
            WHERE tg_id = ?
            """,
            referrer["tg_id"],
        )

    user = await d1_first(db, "SELECT * FROM users WHERE tg_id = ?", body.tg_id)
    return await serialize_user(db, user)


async def maybe_unlock_referral_bonus(db: Any, user: dict[str, Any]) -> None:
    ad_total = await d1_first(
        db,
        "SELECT COALESCE(SUM(amount_paise), 0) AS total FROM transactions WHERE tg_id = ? AND type = 'ad_reward'",
        user["tg_id"],
    )
    ad_earned_paise = int((ad_total or {}).get("total") or 0)
    if not should_unlock_referral_bonus(user, ad_earned_paise):
        return

    referrer_id = optional_int(user.get("referred_by"))
    await d1_run(
        db,
        "UPDATE users SET referral_bonus_paid = 1 WHERE tg_id = ? AND referral_bonus_paid = 0",
        user["tg_id"],
    )
    await d1_run(
        db,
        """
        UPDATE users
        SET balance_paise = balance_paise + ?,
            total_earned_paise = total_earned_paise + ?,
            referral_earnings_paise = referral_earnings_paise + ?
        WHERE tg_id = ?
        """,
        REFERRAL_JOIN_BONUS,
        REFERRAL_JOIN_BONUS,
        REFERRAL_JOIN_BONUS,
        referrer_id,
    )
    await add_transaction(
        db,
        referrer_id,
        "referral_signup",
        REFERRAL_JOIN_BONUS,
        f"Referral bonus unlocked by {user['tg_id']} after ₹50 ad earnings",
    )
    await update_level(db, referrer_id)


def valid_signature(secret: str, payload: str, signature: str | None) -> bool:
    if not secret:
        return True
    if not signature:
        return False
    digest = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    supplied = signature.removeprefix("sha256=")
    return hmac.compare_digest(digest, supplied)


async def mark_token_completed(db: Any, token: str, network: str) -> dict[str, Any]:
    row = await d1_first(db, "SELECT * FROM ad_tokens WHERE token = ? AND network = ?", token, network)
    if not row:
        raise HTTPException(status_code=404, detail="Token not found")
    if int(row.get("used") or 0):
        raise HTTPException(status_code=409, detail="Token already used")
    if row.get("expires_at") < iso_now():
        raise HTTPException(status_code=410, detail="Token expired")
    await d1_run(
        db,
        "UPDATE ad_tokens SET completed = 1, completed_at = ? WHERE token = ?",
        iso_now(),
        token,
    )
    return row


async def telegram_api_call(env: Any, method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if fetch is None:
        return None
    token = env_value(env, "TELEGRAM_BOT_TOKEN")
    if not token:
        return None
    response = await fetch(
        f"https://api.telegram.org/bot{token}/{method}",
        {
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": json.dumps(payload),
        },
    )
    return to_py(await response.json())


async def telegram_send_message(env: Any, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> bool:
    payload: dict[str, Any] = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    data = await telegram_api_call(env, "sendMessage", payload)
    return bool(data and data.get("ok"))


def telegram_reply(chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "method": "sendMessage",
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return payload


async def telegram_answer_callback(env: Any, callback_id: str, text: str, show_alert: bool = False) -> None:
    await telegram_api_call(env, "answerCallbackQuery", {"callback_query_id": callback_id, "text": text, "show_alert": show_alert})


async def telegram_edit_message(env: Any, chat_id: int, message_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    await telegram_api_call(env, "editMessageText", payload)


def admin_id_from_env(env: Any) -> int | None:
    raw = env_value(env, "ADMIN_TG_ID")
    return int(raw) if raw.isdigit() else None


def is_admin(env: Any, tg_id: int) -> bool:
    admin_id = admin_id_from_env(env)
    return admin_id is not None and admin_id == tg_id


def withdrawal_admin_keyboard(withdrawal_id: int) -> dict[str, Any]:
    return {
        "inline_keyboard": [[
            {"text": "Approve", "callback_data": withdrawal_action_callback("approve", withdrawal_id)},
            {"text": "Reject", "callback_data": withdrawal_action_callback("reject", withdrawal_id)},
        ]]
    }


def withdrawal_admin_text(row: dict[str, Any], flagged: bool = False) -> str:
    flag_text = "\nFlag: UPI used by multiple accounts" if flagged else ""
    username = f"\nUsername: @{row['username']}" if row.get("username") else ""
    return (
        f"Withdrawal #{row['id']}\n"
        f"User: <code>{row['tg_id']}</code>{username}\n"
        f"UPI: <code>{row['upi_id']}</code>\n"
        f"Amount: ₹{paise_to_rupees(row['amount_paise']):.2f}\n"
        f"Status: {row['status']}{flag_text}"
    )


async def telegram_is_channel_member(env: Any, channel_username: str, tg_id: int) -> bool:
    if fetch is None:
        return True
    token = env_value(env, "TELEGRAM_BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Task verification is not configured. Telegram bot token is missing.")
    response = await fetch(
        f"https://api.telegram.org/bot{token}/getChatMember?chat_id={channel_username}&user_id={tg_id}"
    )
    data = to_py(await response.json())
    if not data.get("ok"):
        description = str(data.get("description") or "Telegram could not verify channel membership")
        if "member list is inaccessible" in description.lower():
            raise HTTPException(
                status_code=503,
                detail=f"Task verification is not ready for {channel_username}. Add the bot as admin in this channel and try again.",
            )
        raise HTTPException(status_code=400, detail=description)
    status = ((data.get("result") or {}).get("status") or "").lower()
    return status in {"creator", "administrator", "member"}


@app.get("/")
async def root():
    return {"ok": True, "service": "telegram-mini-earn"}


@app.post("/api/register")
async def api_register(body: RegisterBody, req: Request):
    return await register_user(db_from_request(req), body)


@app.get("/api/user/{tg_id}")
async def api_user(tg_id: int, req: Request):
    db = db_from_request(req)
    user = await get_user_or_404(db, tg_id)
    return await serialize_user(db, user)


@app.post("/api/ad-token")
async def api_ad_token(body: AdTokenBody, req: Request):
    db = db_from_request(req)
    await get_user_or_404(db, body.tg_id)
    token = str(uuid.uuid4())
    created = now_ist()
    expires = created + timedelta(minutes=TOKEN_TTL_MINUTES)
    await d1_run(
        db,
        """
        INSERT INTO ad_tokens (token, tg_id, network, created_at, expires_at, used, completed)
        VALUES (?, ?, ?, ?, ?, 0, 0)
        """,
        token,
        body.tg_id,
        body.network,
        created.isoformat(),
        expires.isoformat(),
    )
    return {"token": token, "network": body.network, "expires_at": expires.isoformat()}


@app.post("/api/reward")
async def api_reward(body: RewardBody, req: Request):
    db = db_from_request(req)
    user = await get_user_or_404(db, body.tg_id)
    token = await d1_first(
        db,
        "SELECT * FROM ad_tokens WHERE token = ? AND tg_id = ? AND network = ?",
        body.token,
        body.tg_id,
        body.network,
    )
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    if int(token.get("used") or 0):
        raise HTTPException(status_code=409, detail="Token already used")
    if not int(token.get("completed") or 0):
        raise HTTPException(status_code=400, detail="Ad callback not completed")
    if token.get("expires_at") < iso_now():
        raise HTTPException(status_code=410, detail="Token expired")

    date = today_ist()
    current = await d1_first(
        db,
        "SELECT count FROM daily_ad_counts WHERE tg_id = ? AND activity_date = ? AND network = ?",
        body.tg_id,
        date,
        body.network,
    )
    watched = int(current["count"] if current else 0)
    if watched >= 10:
        raise HTTPException(status_code=429, detail="Daily network limit reached")

    await d1_run(
        db,
        """
        INSERT INTO daily_ad_counts (tg_id, activity_date, network, count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(tg_id, activity_date, network)
        DO UPDATE SET count = count + 1
        """,
        body.tg_id,
        date,
        body.network,
    )
    await d1_run(
        db,
        """
        UPDATE users
        SET balance_paise = balance_paise + ?,
            total_earned_paise = total_earned_paise + ?
        WHERE tg_id = ?
        """,
        AD_REWARD,
        AD_REWARD,
        body.tg_id,
    )
    await d1_run(
        db,
        "UPDATE ad_tokens SET used = 1, used_at = ? WHERE token = ?",
        iso_now(),
        body.token,
    )
    await add_transaction(db, body.tg_id, "ad_reward", AD_REWARD, f"{body.network} ad reward", body.network)
    await maybe_unlock_referral_bonus(db, user)

    level = await update_level(db, body.tg_id)
    updated = await get_user_or_404(db, body.tg_id)
    return {
        "success": True,
        "new_balance": paise_to_rupees(updated["balance_paise"]),
        "level": level,
        "ads_watched_for_network": watched + 1,
    }


@app.post("/api/adsgram-callback")
async def adsgram_callback(req: Request):
    db = db_from_request(req)
    env = req.scope["env"]
    body = await req.json()
    token = body.get("token") or body.get("subid") or body.get("click_id")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True)
    if not valid_signature(env_value(env, "ADSGRAM_WEBHOOK_SECRET"), raw, req.headers.get("x-adsgram-signature")):
        raise HTTPException(status_code=401, detail="Invalid signature")
    await mark_token_completed(db, token, "adsgram")
    return {"success": True}


@app.post("/api/monetag-callback")
async def monetag_callback(token: str, req: Request, secret: str | None = None):
    env = req.scope["env"]
    expected = env_value(env, "MONETAG_POSTBACK_SECRET")
    if expected and not hmac.compare_digest(expected, secret or ""):
        raise HTTPException(status_code=401, detail="Invalid secret")
    await mark_token_completed(db_from_request(req), token, "monetag")
    return {"success": True}

@app.get("/api/tasks")
async def list_tasks(req: Request, tg_id: int | None = None):
    db = db_from_request(req)
    tasks = await d1_all(db, "SELECT * FROM tasks WHERE active = 1 ORDER BY id DESC")
    claimed: set[int] = set()
    if tg_id:
        rows = await d1_all(db, "SELECT task_id FROM task_claims WHERE tg_id = ?", tg_id)
        claimed = {int(row["task_id"]) for row in rows}
    for task in tasks:
        task["reward_amount"] = paise_to_rupees(task.pop("reward_paise", TASK_DEFAULT_REWARD))
        task["completed"] = int(task["id"]) in claimed
    return {"tasks": tasks}


@app.get("/api/energy/{tg_id}")
async def api_energy(tg_id: int, req: Request):
    await get_user_or_404(db_from_request(req), tg_id)
    kv = kv_from_request(req)
    state = await energy_state(kv, tg_id)
    spin = await spin_state(kv, tg_id)
    return {
        **state,
        "max_energy": ENERGY_MAX,
        "boost_daily_cap": ENERGY_BOOST_DAILY_CAP,
        "spins_today": spin["spins_today"],
    }


@app.post("/api/energy/boost")
async def api_energy_boost(body: EnergyActionBody, req: Request):
    await get_user_or_404(db_from_request(req), body.tg_id)
    kv = kv_from_request(req)
    state = await energy_state(kv, body.tg_id)
    if state["boosts_today"] >= ENERGY_BOOST_DAILY_CAP:
        raise HTTPException(status_code=429, detail="Max boosts reached for today")
    state["energy"] = min(ENERGY_MAX, state["energy"] + ENERGY_PER_BOOST)
    state["boosts_today"] += 1
    await save_energy_state(kv, body.tg_id, state)
    return {
        "success": True,
        **state,
        "max_energy": ENERGY_MAX,
        "boost_daily_cap": ENERGY_BOOST_DAILY_CAP,
    }


@app.post("/api/spin")
async def api_spin(body: EnergyActionBody, req: Request):
    db = db_from_request(req)
    await get_user_or_404(db, body.tg_id)
    kv = kv_from_request(req)
    state = await energy_state(kv, body.tg_id)
    if state["energy"] <= 0:
        raise HTTPException(status_code=400, detail="No energy left. Boost energy to spin again.")
    state["energy"] -= 1
    await save_energy_state(kv, body.tg_id, state)
    spin = await spin_state(kv, body.tg_id)
    spin["spins_today"] += 1
    await save_spin_state(kv, body.tg_id, spin)
    reward = random.choice(SPIN_REWARDS)
    reward_paise = reward * 100
    await d1_run(
        db,
        """
        UPDATE users
        SET balance_paise = balance_paise + ?,
            total_earned_paise = total_earned_paise + ?
        WHERE tg_id = ?
        """,
        reward_paise,
        reward_paise,
        body.tg_id,
    )
    await add_transaction(db, body.tg_id, "spin_reward", reward_paise, "Spin wheel reward")
    level = await update_level(db, body.tg_id)
    user = await get_user_or_404(db, body.tg_id)
    return {
        "success": True,
        "reward": reward,
        "new_balance": paise_to_rupees(user["balance_paise"]),
        "level": level,
        **state,
        "max_energy": ENERGY_MAX,
        "spins_today": spin["spins_today"],
    }


@app.get("/api/challenges/{tg_id}")
async def api_challenges(tg_id: int, req: Request):
    await get_user_or_404(db_from_request(req), tg_id)
    state = await challenge_state(kv_from_request(req), tg_id)
    return {**state, "daily_cap": CHALLENGE_DAILY_CAP}


@app.post("/api/challenges/complete")
async def api_challenge_complete(body: ChallengeCompleteBody, req: Request):
    db = db_from_request(req)
    await get_user_or_404(db, body.tg_id)
    kv = kv_from_request(req)
    state = await challenge_state(kv, body.tg_id)
    if state["done_today"] >= CHALLENGE_DAILY_CAP:
        raise HTTPException(status_code=429, detail="Come back tomorrow!")

    reward = int(state["rewards_today"][body.slot])
    reward_paise = reward * 100
    state["done_today"] += 1
    await save_challenge_state(kv, body.tg_id, state)
    await d1_run(
        db,
        """
        UPDATE users
        SET balance_paise = balance_paise + ?,
            total_earned_paise = total_earned_paise + ?
        WHERE tg_id = ?
        """,
        reward_paise,
        reward_paise,
        body.tg_id,
    )
    await add_transaction(db, body.tg_id, "challenge_reward", reward_paise, "Daily challenge reward", "monetag")
    level = await update_level(db, body.tg_id)
    user = await get_user_or_404(db, body.tg_id)
    return {
        "success": True,
        "reward": reward,
        "new_balance": paise_to_rupees(user["balance_paise"]),
        "level": level,
        **state,
        "daily_cap": CHALLENGE_DAILY_CAP,
    }


@app.post("/api/tasks/{task_id}/verify")
async def verify_task(task_id: int, body: TaskVerifyBody, req: Request):
    db = db_from_request(req)
    env = req.scope["env"]
    await get_user_or_404(db, body.tg_id)
    task = await d1_first(db, "SELECT * FROM tasks WHERE id = ? AND active = 1", task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    existing = await d1_first(db, "SELECT id FROM task_claims WHERE tg_id = ? AND task_id = ?", body.tg_id, task_id)
    if existing:
        raise HTTPException(status_code=409, detail="Task already claimed")

    if not await telegram_is_channel_member(env, task["channel_username"], body.tg_id):
        raise HTTPException(status_code=400, detail="Join the channel before claiming this task")

    await d1_run(
        db,
        "INSERT INTO task_claims (tg_id, task_id, claimed_at) VALUES (?, ?, ?)",
        body.tg_id,
        task_id,
        iso_now(),
    )
    await d1_run(
        db,
        "UPDATE users SET balance_paise = balance_paise + ?, total_earned_paise = total_earned_paise + ? WHERE tg_id = ?",
        task["reward_paise"],
        task["reward_paise"],
        body.tg_id,
    )
    await add_transaction(db, body.tg_id, "task_reward", task["reward_paise"], f"Joined {task['channel_name']}")
    await update_level(db, body.tg_id)
    user = await get_user_or_404(db, body.tg_id)
    return {"success": True, "new_balance": paise_to_rupees(user["balance_paise"])}


@app.post("/api/withdraw")
async def withdraw(body: WithdrawBody, req: Request):
    db = db_from_request(req)
    env = req.scope["env"]
    user = await get_user_or_404(db, body.tg_id)
    amount_paise = rupees_to_paise(body.amount)
    if amount_paise < MIN_WITHDRAWAL:
        raise HTTPException(status_code=400, detail="Minimum withdrawal is ₹500")
    if int(user["balance_paise"] or 0) < amount_paise:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    if datetime.fromisoformat(user["created_at"]) > now_ist() - timedelta(hours=24):
        raise HTTPException(status_code=400, detail="New accounts cannot withdraw for 24 hours")

    upi = body.upi_id.strip().lower()
    same_upi = await d1_first(
        db,
        "SELECT COUNT(DISTINCT tg_id) AS accounts FROM users WHERE lower(upi_id) = ? AND tg_id != ?",
        upi,
        body.tg_id,
    )
    flagged = int(same_upi["accounts"] or 0) >= 1

    await d1_run(
        db,
        "UPDATE users SET balance_paise = balance_paise - ?, total_withdrawn_paise = total_withdrawn_paise + ?, upi_id = ? WHERE tg_id = ?",
        amount_paise,
        amount_paise,
        upi,
        body.tg_id,
    )
    requested_at = iso_now()
    await d1_run(
        db,
        """
        INSERT INTO withdrawals (tg_id, upi_id, amount_paise, status, requested_at)
        VALUES (?, ?, ?, 'pending', ?)
        """,
        body.tg_id,
        upi,
        amount_paise,
        requested_at,
    )
    await add_transaction(db, body.tg_id, "withdrawal_pending", -amount_paise, "Withdrawal requested")

    withdrawal_row = await d1_first(
        db,
        "SELECT id, tg_id, upi_id, amount_paise, status, requested_at FROM withdrawals WHERE tg_id = ? AND requested_at = ?",
        body.tg_id,
        requested_at,
    )
    admin_warning = None
    admin_id = admin_id_from_env(env)
    if admin_id:
        sent = await telegram_send_message(
            env,
            admin_id,
            withdrawal_admin_text(withdrawal_row, flagged),
            withdrawal_admin_keyboard(int(withdrawal_row["id"])),
        )
        if not sent:
            admin_warning = "Withdrawal created, but admin Telegram notification failed."
    else:
        admin_warning = "Withdrawal created, but ADMIN_TG_ID is not configured."

    user = await get_user_or_404(db, body.tg_id)
    return {
        "success": True,
        "new_balance": paise_to_rupees(user["balance_paise"]),
        "flagged": flagged,
        "withdrawal_id": int(withdrawal_row["id"]),
        "admin_warning": admin_warning,
    }


@app.get("/api/withdrawals/{tg_id}")
async def withdrawal_history(tg_id: int, req: Request):
    db = db_from_request(req)
    await get_user_or_404(db, tg_id)
    rows = await d1_all(
        db,
        "SELECT id, upi_id, amount_paise, status, requested_at, processed_at FROM withdrawals WHERE tg_id = ? ORDER BY requested_at DESC LIMIT 20",
        tg_id,
    )
    for row in rows:
        row["amount"] = paise_to_rupees(row.pop("amount_paise"))
    return {"withdrawals": rows}


async def list_pending_withdrawals(db: Any) -> list[dict[str, Any]]:
    return await d1_all(
        db,
        """
        SELECT w.id, w.tg_id, u.username, w.upi_id, w.amount_paise, w.status, w.requested_at
        FROM withdrawals w
        LEFT JOIN users u ON u.tg_id = w.tg_id
        WHERE w.status = 'pending'
        ORDER BY w.requested_at ASC
        LIMIT 10
        """,
    )


async def process_withdrawal_action(db: Any, withdrawal_id: int, action: str) -> tuple[str, dict[str, Any] | None, bool]:
    row = await d1_first(db, "SELECT * FROM withdrawals WHERE id = ?", withdrawal_id)
    if not row:
        return "Withdrawal not found.", None, False
    if row["status"] != "pending":
        return f"Already processed: {row['status']}.", row, False

    processed_at = iso_now()
    if action == "approve":
        result = await d1_run(
            db,
            "UPDATE withdrawals SET status = 'approved', processed_at = ? WHERE id = ? AND status = 'pending'",
            processed_at,
            withdrawal_id,
        )
        if not d1_changes(result):
            updated = await d1_first(db, "SELECT * FROM withdrawals WHERE id = ?", withdrawal_id)
            return f"Already processed: {updated['status']}.", updated, False
        await add_transaction(db, row["tg_id"], "withdrawal_approved", 0, f"Withdrawal #{withdrawal_id} approved")
        row["status"] = "approved"
        row["processed_at"] = processed_at
        return "Withdrawal approved.", row, True

    if action == "reject":
        result = await d1_run(
            db,
            "UPDATE withdrawals SET status = 'rejected', processed_at = ? WHERE id = ? AND status = 'pending'",
            processed_at,
            withdrawal_id,
        )
        if not d1_changes(result):
            updated = await d1_first(db, "SELECT * FROM withdrawals WHERE id = ?", withdrawal_id)
            return f"Already processed: {updated['status']}.", updated, False
        await d1_run(
            db,
            """
            UPDATE users
            SET balance_paise = balance_paise + ?,
                total_withdrawn_paise = MAX(total_withdrawn_paise - ?, 0)
            WHERE tg_id = ?
            """,
            row["amount_paise"],
            row["amount_paise"],
            row["tg_id"],
        )
        await add_transaction(
            db,
            row["tg_id"],
            "withdrawal_rejected_refund",
            row["amount_paise"],
            f"Withdrawal #{withdrawal_id} rejected and refunded",
        )
        row["status"] = "rejected"
        row["processed_at"] = processed_at
        return "Withdrawal rejected and refunded.", row, True

    return "Unknown withdrawal action.", row, False


@app.get("/api/leaderboard")
async def leaderboard(req: Request):
    db = db_from_request(req)
    week_ago = (now_ist() - timedelta(days=7)).isoformat()
    rows = await d1_all(
        db,
        """
        SELECT u.tg_id, u.first_name, u.username, SUM(t.amount_paise) AS earned_paise
        FROM transactions t
        JOIN users u ON u.tg_id = t.tg_id
        WHERE t.amount_paise > 0 AND t.timestamp >= ?
        GROUP BY u.tg_id, u.first_name, u.username
        ORDER BY earned_paise DESC
        LIMIT 10
        """,
        week_ago,
    )
    for row in rows:
        row["earned"] = paise_to_rupees(row.pop("earned_paise"))
    return {"leaderboard": rows}


@app.post("/telegram/webhook")
async def telegram_webhook(req: Request):
    db = db_from_request(req)
    env = req.scope["env"]
    update = await req.json()
    callback = update.get("callback_query") or {}
    if callback:
        callback_id = callback.get("id")
        callback_user = callback.get("from") or {}
        callback_user_id = int(callback_user.get("id") or 0)
        data = callback.get("data") or ""
        message = callback.get("message") or {}
        chat = message.get("chat") or {}

        if not is_admin(env, callback_user_id):
            if callback_id:
                await telegram_answer_callback(env, callback_id, "Not authorized.", True)
            return {"ok": True}

        parts = data.split(":")
        if len(parts) == 3 and parts[0] == "withdraw" and parts[1] in {"approve", "reject"} and parts[2].isdigit():
            status_text, row, changed = await process_withdrawal_action(db, int(parts[2]), parts[1])
            if callback_id:
                await telegram_answer_callback(env, callback_id, status_text)
            if row and chat.get("id") and message.get("message_id"):
                await telegram_edit_message(
                    env,
                    int(chat["id"]),
                    int(message["message_id"]),
                    withdrawal_admin_text(row) + f"\n\n{status_text}",
                )
            if changed and row and row.get("tg_id") and row.get("status") in {"approved", "rejected"}:
                user_text = (
                    f"Your withdrawal #{row['id']} was approved."
                    if row["status"] == "approved"
                    else f"Your withdrawal #{row['id']} was rejected and refunded."
                )
                await telegram_send_message(env, int(row["tg_id"]), user_text)
            return {"ok": True}

        if callback_id:
            await telegram_answer_callback(env, callback_id, "Unknown action.", True)
        return {"ok": True}

    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    text = (message.get("text") or "").strip()
    if not chat or not user or not text.startswith("/"):
        return {"ok": True}

    chat_id = int(chat["id"])
    tg_id = int(user["id"])
    parts = text.split(maxsplit=1)
    command = parts[0].split("@")[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else None

    mini_url = env_value(env, "MINI_APP_URL")
    bot_name = env_value(env, "BOT_USERNAME", "BOTNAME")
    registered = await register_user(
        db,
        RegisterBody(
            tg_id=tg_id,
            username=user.get("username"),
            first_name=user.get("first_name"),
            referral_code=arg if command == "/start" else None,
        ),
    )

    if command == "/start":
        keyboard = {"inline_keyboard": [[{"text": "Open Mini App", "web_app": {"url": mini_url}}]]} if mini_url else None
        return telegram_reply(
            chat_id,
            f"Welcome, {registered.get('first_name') or 'friend'}!\nYour ₹25 welcome bonus is ready.\nBalance: ₹{registered['balance']:.2f}",
            keyboard,
        )
    elif command == "/balance":
        return telegram_reply(chat_id, f"Available balance: ₹{registered['balance']:.2f}")
    elif command == "/refer":
        link = f"https://t.me/{bot_name}?start={registered['referral_code']}"
        return telegram_reply(
            chat_id,
            f"Your referral link:\n{link}\n\nFriends joined: {registered['referral_count']}\nReferral earnings: ₹{registered['referral_earnings']:.2f}\nEarn ₹10 when your friend earns ₹50 from ads.",
        )
    elif command == "/withdraw":
        keyboard = {"inline_keyboard": [[{"text": "Open Withdrawal Form", "web_app": {"url": mini_url + '#withdraw'}}]]} if mini_url else None
        return telegram_reply(chat_id, "Open the Mini App withdrawal form to request payout.", keyboard)
    elif command == "/admin_withdrawals":
        if not is_admin(env, tg_id):
            return telegram_reply(chat_id, "Not authorized.")
        pending = await list_pending_withdrawals(db)
        if not pending:
            return telegram_reply(chat_id, "No pending withdrawals.")
        lines = ["Pending withdrawals:"]
        keyboard = {"inline_keyboard": []}
        for row in pending:
            lines.append(f"#{row['id']} | User {row['tg_id']} | ₹{paise_to_rupees(row['amount_paise']):.2f} | {row['upi_id']}")
            keyboard["inline_keyboard"].append([
                {"text": f"Approve #{row['id']}", "callback_data": withdrawal_action_callback("approve", int(row["id"]))},
                {"text": f"Reject #{row['id']}", "callback_data": withdrawal_action_callback("reject", int(row["id"]))},
            ])
        return telegram_reply(chat_id, "\n".join(lines), keyboard)
    elif command == "/help":
        return telegram_reply(
            chat_id,
            "/start - Open Mini App\n/balance - Show balance\n/refer - Referral link and stats\n/withdraw - Withdrawal form\n/admin_withdrawals - Admin pending withdrawals\n/help - Commands list",
        )
    return {"ok": True}
