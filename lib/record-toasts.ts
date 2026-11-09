/**
 * 记账成功后底部弹出的短句。
 *
 * 按「这一笔的金额」分档：钱越多，语气越夸张。
 * 支出越花越心疼（自嘲调侃），收入越进越惊喜。
 * 每条都控制在 16 字内，弹出来不折行。
 */
export type RecordKind = 'income' | 'expense';

type Tier = {
  /** 本档的上限（不含），单位：分。 */
  upTo: number;
  /** 这一档的候选短句。 */
  toasts: readonly string[];
};

/**
 * 支出：< ¥30 零碎 / < ¥150 日常 / < ¥500 心疼 / 以上暴击。
 * 阈值按「单笔金额」算，改这里即可调整分档。
 */
const EXPENSE_TIERS: readonly Tier[] = [
  {
    upTo: 3_000,
    toasts: [
      '这点小钱，伤不到我',
      '小钱钱出门遛个弯',
      '一杯奶茶的代价，值',
      '花得随意，记得认真',
      '零碎的快乐，不贵',
    ],
  },
  {
    upTo: 15_000,
    toasts: [
      '一顿饭的功夫，钱没了',
      '钱包稍微瘪了一下',
      '这是生活的固定成本',
      '每一分都花在正经事上',
      '又被生活按头消费了',
    ],
  },
  {
    upTo: 50_000,
    toasts: [
      '钱包明显凹下去一块',
      '这一笔，够我念叨三天',
      '心跳和余额一起下降',
      '买的时候爽，记的时候抖',
      '钱包：容我缓一缓',
    ],
  },
  {
    upTo: Number.POSITIVE_INFINITY,
    toasts: [
      '记账的手，微微发抖',
      '余额：我先退下了',
      '花的不是钱，是勇气',
      '钱包当场表演了消失',
      '这一笔，够心疼到月底',
    ],
  },
];

/**
 * 收入：< ¥300 零花 / < ¥3000 回血 / < ¥10000 惊喜 / 以上大惊喜。
 */
const INCOME_TIERS: readonly Tier[] = [
  {
    upTo: 30_000,
    toasts: [
      '到账啦，余额偷偷笑了',
      '有点小钱进账，开心',
      '零花到账，稳步前进',
      '这一分，也是赚的',
      '小确幸，已入账',
    ],
  },
  {
    upTo: 300_000,
    toasts: [
      '钱包回了一口血',
      '钱包：我站起来了',
      '又多了一点点底气',
      '到账一秒，快乐三秒',
      '收入记下了，心也安了',
    ],
  },
  {
    upTo: 1_000_000,
    toasts: [
      '存钱罐，砰的一声满了',
      '余额终于像样了',
      '这一笔，够开心到周末',
      '腰杆，不自觉地直了',
      '攒钱进度条，肉眼可见',
    ],
  },
  {
    upTo: Number.POSITIVE_INFINITY,
    toasts: [
      '我没数错吧？这么多',
      '我要抱着这笔钱睡一觉',
      '余额跳了一下，心也跳了',
      '先别动，让我再数一遍',
      '这一刻，我有点小富',
    ],
  },
];

/** 每种类型各自记住上一条，避免连着两笔弹同一句话。 */
const previous: Record<RecordKind, string> = { income: '', expense: '' };

export function pickRecordToast(kind: RecordKind, cents: number) {
  const tiers = kind === 'income' ? INCOME_TIERS : EXPENSE_TIERS;
  const tier = tiers.find((item) => cents < item.upTo) ?? tiers[tiers.length - 1];
  const fresh = tier.toasts.filter((text) => text !== previous[kind]);
  const next = fresh[Math.floor(Math.random() * fresh.length)] ?? tier.toasts[0];
  previous[kind] = next;
  return next;
}
