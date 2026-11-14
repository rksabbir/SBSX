// টপ বায়ার (সাপোর্টার) লিডারবোর্ড — অর্ডার ডেটা থেকে র‍্যাংকিং, রিয়েল-টাইম লিস্ট,
// আর রিপোর্ট টেক্সট। সব pure ফাংশন, তাই Discord/Firebase ছাড়াই টেস্ট হয়।

const SUPPORTER_BADGES = [
  { min: 100000, label: "🏆 প্লাটিনাম সাপোর্টার", color: "#00E5FF" },
  { min: 50000, label: "🥇 গোল্ড সাপোর্টার", color: "#FFD700" },
  { min: 20000, label: "🥈 সিলভার সাপোর্টার", color: "#C0C0C0" },
  { min: 5000, label: "🥉 ব্রোঞ্জ সাপোর্টার", color: "#CD7F32" },
  { min: 1, label: "💎 সাপোর্টার", color: "#7BC862" }
];

function badgeFor(totalPaid) {
  const amount = Number(totalPaid) || 0;
  for (const badge of SUPPORTER_BADGES) if (amount >= badge.min) return badge;
  return { label: "—", color: "#95A5A6" };
}

/** অর্ডার ডেটা থেকে প্রতিটি ইউজারের মোট, সংখ্যা ও শেষ অর্ডার হিসাব করে র‍্যাংকিং বানায়। */
function buildSupporterBoard({ orders = [], limit = 10, now = Date.now(), includeZero = false } = {}) {
  const map = new Map();
  for (const order of orders || []) {
    if (!order) continue;
    const userId = String(order.discordUserId || order.userId || "");
    if (!userId) continue;
    const paid = Number(order.paidAmount ?? order.approvedAmount ?? order.amount) || 0;
    const at = Number(order.paidAt || order.approvedAt || order.createdAt || order.reviewedAt) || 0;
    const entry = map.get(userId) || {
      userId, username: "", totalPaid: 0, orders: 0, firstOrderAt: 0, lastOrderAt: 0, packages: new Set()
    };
    entry.totalPaid += paid;
    entry.orders += 1;
    if (!entry.username && order.username) entry.username = String(order.username);
    if (at) {
      entry.firstOrderAt = entry.firstOrderAt ? Math.min(entry.firstOrderAt, at) : at;
      entry.lastOrderAt = Math.max(entry.lastOrderAt, at);
    }
    const packageName = String(order.package || order.category || "").trim();
    if (packageName) entry.packages.add(packageName);
    map.set(userId, entry);
  }

  const rows = [...map.values()]
    .filter(entry => includeZero || entry.totalPaid > 0)
    .sort((a, b) => b.totalPaid - a.totalPaid || b.orders - a.orders || a.lastOrderAt - b.lastOrderAt)
    .map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      username: entry.username,
      totalPaid: Math.round(entry.totalPaid * 100) / 100,
      orders: entry.orders,
      firstOrderAt: entry.firstOrderAt,
      lastOrderAt: entry.lastOrderAt,
      packages: [...entry.packages].slice(0, 5),
      badge: badgeFor(entry.totalPaid).label,
      color: badgeFor(entry.totalPaid).color,
      daysSinceLastOrder: entry.lastOrderAt ? Math.floor((now - entry.lastOrderAt) / 86_400_000) : null
    }));

  const totalSupport = rows.reduce((sum, row) => sum + row.totalPaid, 0);
  return {
    rows: rows.slice(0, Math.max(1, Math.min(50, Number(limit) || 10))),
    totalSupporters: rows.length,
    totalSupport: Math.round(totalSupport * 100) / 100,
    topSupport: rows[0] || null,
    updatedAt: Number(now) || Date.now()
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];

function rankLabel(rank) {
  return MEDALS[rank - 1] || `#${rank}`;
}

function bdt(value) {
  const amount = Number(value) || 0;
  return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function relativeDays(days) {
  if (days === null || days === undefined) return "—";
  if (days <= 0) return "আজ";
  if (days === 1) return "গতকাল";
  return `${days} দিন আগে`;
}

/** ডিসকর্ডে দেখানোর একটি লাইন — সাপোর্টারের মেনশন, মোট টাকা, প্যাকেজ। */
function formatSupporterLine(row) {
  if (!row) return "";
  const user = row.userId ? `<@${row.userId}>` : (row.username || "Unknown");
  const packages = row.packages?.length ? ` · ${row.packages.join(", ")}` : "";
  return `${rankLabel(row.rank)} ${user} — **${bdt(row.totalPaid)} ৳** (${row.orders} order${packages})`;
}

function formatSupporterBoardText(board, { maxRows = 10 } = {}) {
  if (!board || !board.rows?.length) {
    return "📊 এখনো কোনো সাপোর্টারের তথ্য নেই — প্রথম অর্ডার হলেই এখানে দেখা যাবে।";
  }
  const lines = board.rows.slice(0, maxRows).map(formatSupporterLine);
  return [
    "🏆 **টপ সাপোর্টার — রিয়েল-টাইম**",
    ...lines,
    "",
    `👥 মোট সাপোর্টার: **${board.totalSupporters}** · 💰 মোট সাপোর্ট: **${bdt(board.totalSupport)} ৳**`
  ].join("\n");
}

/** সাপোর্টারের নিজের র‍্যাংক/অবস্থান (অর্ডার টিকিট বা ওয়েলকামে দেখানো যায়)। */
function describeSupporterStanding(board, userId) {
  const row = board?.rows?.find(entry => entry.userId === String(userId || ""));
  if (!row) return "";
  return `🏅 আপনি **${rankLabel(row.rank)}** অবস্থানে — মোট **${bdt(row.totalPaid)} ৳** (${row.orders} order) · ${row.badge}`;
}

module.exports = {
  SUPPORTER_BADGES,
  badgeFor,
  buildSupporterBoard,
  rankLabel,
  formatSupporterLine,
  formatSupporterBoardText,
  describeSupporterStanding,
  relativeDays
};
