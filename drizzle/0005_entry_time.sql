-- 给账目增加发生时刻：北京时间 HH:mm，只存时分，日期仍由 date 列表示。
-- 可重复执行：已存在的列会被忽略。

ALTER TABLE `entries` ADD `time` text DEFAULT '' NOT NULL;
