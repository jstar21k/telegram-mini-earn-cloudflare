ALTER TABLE users ADD COLUMN free_spin_used INTEGER DEFAULT 0;

UPDATE users
SET energy = 0,
    boosts_today = 0,
    spins_today = 0,
    energy_reset_date = '',
    spin_reset_date = ''
WHERE energy > 0;
