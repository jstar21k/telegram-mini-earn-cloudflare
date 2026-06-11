import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worker_main", ROOT / "worker" / "main.py")
worker_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker_main)


def test_money_conversion_round_trip():
    assert worker_main.rupees_to_paise(400) == 40000
    assert worker_main.paise_to_rupees(5050) == 50.5


def test_level_thresholds():
    assert worker_main.calc_level(0) == "bronze"
    assert worker_main.calc_level(49999) == "bronze"
    assert worker_main.calc_level(50000) == "silver"
    assert worker_main.calc_level(199999) == "silver"
    assert worker_main.calc_level(200000) == "gold"


def test_referral_rules():
    assert worker_main.REFERRAL_JOIN_BONUS == 1000
    assert worker_main.REFERRAL_AD_EARN_THRESHOLD == 5000
    assert worker_main.WELCOME_BONUS == 2500
    assert worker_main.AD_REWARD == 500
    assert not hasattr(worker_main, "PASSIVE_REFERRAL_REWARD")


def test_referral_unlock_threshold():
    referred_user = {"referred_by": 1, "referral_bonus_paid": 0}
    assert worker_main.should_unlock_referral_bonus(referred_user, 4999) is False
    assert worker_main.should_unlock_referral_bonus(referred_user, 5000) is True
    assert worker_main.should_unlock_referral_bonus({"referred_by": 1, "referral_bonus_paid": 1}, 5000) is False
    assert worker_main.should_unlock_referral_bonus({"referred_by": None, "referral_bonus_paid": 0}, 5000) is False


def test_minimum_withdrawal_rule():
    assert worker_main.MIN_WITHDRAWAL == 50000


def test_active_ad_networks():
    assert worker_main.NETWORKS == {"adsgram", "monetag"}


def test_spin_segments_match_config():
    assert worker_main.SPIN_SEGMENTS == [
        {"id": 1, "reward": 5, "weight": 30.0},
        {"id": 2, "reward": 5, "weight": 30.0},
        {"id": 3, "reward": 10, "weight": 20.0},
        {"id": 4, "reward": 20, "weight": 10.0},
        {"id": 5, "reward": 20, "weight": 5.0},
        {"id": 6, "reward": 50, "weight": 3.0},
        {"id": 7, "reward": 100, "weight": 1.5},
        {"id": 8, "reward": 500, "weight": 0.5},
    ]


def test_spin_and_challenge_limits():
    assert worker_main.ENERGY_MAX == 10
    assert worker_main.ENERGY_BOOST_DAILY_CAP == 15
    assert worker_main.SPIN_DAILY_CAP == 15
    assert worker_main.CHALLENGE_DAILY_CAP == 15
    assert worker_main.CHALLENGE_SLOTS == 15


def test_withdrawal_callback_data():
    assert worker_main.withdrawal_action_callback("approve", 42) == "withdraw:approve:42"
    assert worker_main.withdrawal_action_callback("reject", 42) == "withdraw:reject:42"


def test_admin_detection():
    assert worker_main.admin_id_from_env({"ADMIN_TG_ID": "123456789"}) == 123456789
    assert worker_main.is_admin({"ADMIN_TG_ID": "123456789"}, 123456789) is True
    assert worker_main.is_admin({"ADMIN_TG_ID": "123456789"}, 123) is False
    assert worker_main.is_admin({"ADMIN_TG_ID": ""}, 123456789) is False


def test_signature_validation_with_empty_secret_is_dev_mode():
    assert worker_main.valid_signature("", "payload", None) is True


def test_signature_validation_with_secret():
    secret = "secret"
    payload = "payload"
    digest = worker_main.hmac.new(secret.encode(), payload.encode(), worker_main.hashlib.sha256).hexdigest()
    assert worker_main.valid_signature(secret, payload, f"sha256={digest}") is True
    assert worker_main.valid_signature(secret, payload, "bad") is False
