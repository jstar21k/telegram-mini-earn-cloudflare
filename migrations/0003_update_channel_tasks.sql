UPDATE tasks
SET channel_username = '@open_link_and_earn',
    channel_name = 'Update Channel',
    reward_paise = 1000,
    active = 1
WHERE channel_username = '@YourChannel';

UPDATE tasks
SET channel_username = '@link69_viral',
    channel_name = 'Partner / Sponsor',
    reward_paise = 1000,
    active = 1
WHERE channel_username = '@PartnerChannel';

INSERT INTO tasks (channel_username, channel_name, reward_paise, active)
SELECT '@open_link_and_earn', 'Update Channel', 1000, 1
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE channel_username = '@open_link_and_earn');

INSERT INTO tasks (channel_username, channel_name, reward_paise, active)
SELECT '@link69_viral', 'Partner / Sponsor', 1000, 1
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE channel_username = '@link69_viral');
