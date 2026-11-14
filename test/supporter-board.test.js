const test = require("node:test");
const assert = require("node:assert");

const {
  SUPPORTER_BADGES,
  badgeFor,
  buildSupporterBoard,
  rankLabel,
  formatSupporterBoardText,
  describeSupporterStanding,
  relativeDays
} = require("../supporter-board");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const orders = [
  { discordUserId: "u1", paidAmount: 30000, package: "monthly", paidAt: NOW - 2 * DAY, username: "sabbir" },
  { discordUserId: "u2", paidAmount: 20000, package: "2_months", paidAt: NOW - DAY },
  { discordUserId: "u2", paidAmount: 5000, package: "weekly", paidAt: NOW },
  { discordUserId: "u3", paidAmount: 1500, package: "weekly", paidAt: NOW - 5 * DAY }
];

test("supporter board: ranks users by total paid, newest wins ties", () => {
  const board = buildSupporterBoard({ orders, now: NOW, limit: 10 });
  assert.deepEqual(board.rows.map(row => row.userId), ["u1", "u2", "u3"]);
  assert.equal(board.rows[0].totalPaid, 30000);
  assert.equal(board.rows[1].totalPaid, 25000);
  assert.equal(board.rows[1].orders, 2);
  assert.equal(board.totalSupporters, 3);
  assert.equal(board.totalSupport, 56500);
  assert.deepEqual(board.rows[1].packages.sort(), ["2_months", "weekly"]);
});

test("supporter board: badges follow total spend tiers", () => {
  assert.match(badgeFor(150000).label, /প্লাটিনাম/);
  assert.match(badgeFor(60000).label, /গোল্ড/);
  assert.match(badgeFor(25000).label, /সিলভার/);
  assert.match(badgeFor(6000).label, /ব্রোঞ্জ/);
  assert.match(badgeFor(10).label, /সাপোর্টার/);
  assert.equal(badgeFor(0).label, "—");
  assert.equal(SUPPORTER_BADGES[0].min, 100000);
});

test("supporter board: limit truncates rows but keeps totals", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    discordUserId: `u${i}`, paidAmount: 1000 + i * 10, paidAt: NOW - i * DAY
  }));
  const board = buildSupporterBoard({ orders: many, now: NOW, limit: 5 });
  assert.equal(board.rows.length, 5);
  assert.equal(board.totalSupporters, 25);
  assert.equal(board.rows[0].userId, "u24");
  assert.equal(board.topSupport.userId, "u24");
});

test("supporter board: ignores invalid orders and zero amounts by default", () => {
  const board = buildSupporterBoard({
    orders: [null, { userId: "" }, { discordUserId: "u9", paidAmount: 0 }, ...orders],
    now: NOW
  });
  assert.equal(board.rows.some(row => row.userId === "u9"), false);
  const withZero = buildSupporterBoard({
    orders: [{ discordUserId: "u9", paidAmount: 0 }], now: NOW, includeZero: true
  });
  assert.equal(withZero.rows.length, 1);
});

test("supporter board: text shows mentions, medals and totals", () => {
  const board = buildSupporterBoard({ orders, now: NOW });
  const text = formatSupporterBoardText(board);
  assert.match(text, /<@u1>/);
  assert.match(text, /<@u2>/);
  assert.match(text, /30,000 ৳/);
  assert.match(text, /মোট সাপোর্টার: \*\*3\*\*/);
  assert.match(text, /🥇/);
});

test("supporter board: empty board has a friendly Bangla message", () => {
  const text = formatSupporterBoardText(buildSupporterBoard({ orders: [], now: NOW }));
  assert.match(text, /এখনো কোনো সাপোর্টারের তথ্য নেই/);
});

test("supporter board: rank labels and relative days", () => {
  assert.equal(rankLabel(1), "🥇");
  assert.equal(rankLabel(2), "🥈");
  assert.equal(rankLabel(3), "🥉");
  assert.equal(rankLabel(7), "#7");
  assert.equal(relativeDays(0), "আজ");
  assert.equal(relativeDays(1), "গতকাল");
  assert.equal(relativeDays(9), "9 দিন আগে");
  assert.equal(relativeDays(null), "—");
});

test("supporter board: standing text for a single user", () => {
  const board = buildSupporterBoard({ orders, now: NOW });
  const text = describeSupporterStanding(board, "u2");
  assert.match(text, /🥈/);
  assert.match(text, /25,000 ৳/);
  assert.equal(describeSupporterStanding(board, "nobody"), "");
});

test("supporter board: days since last order is calculated for ranking decay", () => {
  const board = buildSupporterBoard({ orders, now: NOW });
  assert.equal(board.rows.find(row => row.userId === "u2").daysSinceLastOrder, 0);
  assert.equal(board.rows.find(row => row.userId === "u3").daysSinceLastOrder, 5);
  assert.equal(board.rows.find(row => row.userId === "u1").daysSinceLastOrder, 2);
});
