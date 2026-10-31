-- 把归属从「显示名」迁移为稳定的 owner key（qing / hua / together）。
-- 迁移后改名只更新 owners.name，不再回写 entries / avatars。
-- 可重复执行：已经是 key 的记录会被跳过。

UPDATE `entries`
SET `owner` = COALESCE(
  (SELECT `key` FROM `owners` WHERE `name` = `entries`.`owner`),
  CASE `owner`
    WHEN '青' THEN 'qing'
    WHEN '男生' THEN 'qing'
    WHEN '华' THEN 'hua'
    WHEN '女生' THEN 'hua'
    WHEN '伊' THEN 'hua'
    WHEN '共同' THEN 'together'
    ELSE 'together'
  END
)
WHERE `owner` NOT IN ('qing', 'hua', 'together');
--> statement-breakpoint

CREATE TABLE `avatars_owner_keys` (
	`owner` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint

INSERT OR REPLACE INTO `avatars_owner_keys` (`owner`, `data`, `updated_at`)
SELECT
  CASE
    WHEN `owner` IN ('qing', 'hua', 'together') THEN `owner`
    ELSE COALESCE(
      (SELECT `key` FROM `owners` WHERE `name` = `avatars`.`owner`),
      CASE `owner`
        WHEN '青' THEN 'qing'
        WHEN '男生' THEN 'qing'
        WHEN '华' THEN 'hua'
        WHEN '女生' THEN 'hua'
        WHEN '伊' THEN 'hua'
        WHEN '共同' THEN 'together'
        ELSE 'together'
      END
    )
  END,
  `data`,
  `updated_at`
FROM `avatars`;
--> statement-breakpoint

DELETE FROM `avatars`;
--> statement-breakpoint

INSERT INTO `avatars` (`owner`, `data`, `updated_at`)
SELECT `owner`, `data`, `updated_at` FROM `avatars_owner_keys`;
--> statement-breakpoint

DROP TABLE `avatars_owner_keys`;
