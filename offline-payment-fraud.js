// Offline payment fraud handling: fake payment ধরা পড়লে credit ফেরত + account ban.
// Side-effect free — index.js শুধু এখানকার সিদ্ধান্ত অনুযায়ী Firebase/Discord-এ লিখবে।

const OFFLINE_FRAUD_REASONS = [
  { value: "txn_not_found", label: "TxnID provider history-তে নেই (সম্পূর্ণ ফেক)" },
  { value: "amount_mismatch", label: "পাঠানো টাকার পরিমাণ মেলেনি" },
  { value: "duplicate_txn", label: "একই TxnID একাধিকবার ব্যবহার" },
  { value: "old_transaction", label: "পুরোনো transaction দেখিয়ে ফাঁকি" },
  { value: "wrong_account", label: "ভুল/পরিশোধ না করেই দাবি" },
  { value: "other", label: "অন্যান্য (নোট দেখুন)" }
];

function normalizeFraudReason(code, note) {
  const known = OFFLINE_FRAUD_REASONS.find(r => r.value === String(code || ""));
  const reasonCode = known ? known.value : "other";
  const reasonLabel = (known || OFFLINE_FRAUD_REASONS[OFFLINE_FRAUD_REASONS.length - 1]).label;
  return { reasonCode, reasonLabel, note: String(note || "").trim().slice(0, 300) };
}

// revoke করার সময় checkout session-এর credit শূন্য করে, তবে transaction record মুছে ফেলা হয় না —
// প্রমাণ হিসেবে `flagged` রাখা হয়।
function buildSessionRevokePatch(current, { requestId, actorId, now }) {
  if (!current || typeof current !== "object") return undefined;
  if (String(current.offlinePaymentRequestId || "") !== String(requestId || "")) return undefined;
  const markers = (Array.isArray(current.usedTxns) ? current.usedTxns : [])
    .filter(marker => !String(marker).startsWith(`OFFLINE_ADMIN_APPROVED:${requestId}`) &&
      !String(marker).startsWith(`OFFLINE_AUTO_APPROVED:${requestId}`));
  return {
    ...current,
    status: "offline_payment_revoked",
    totalPaid: 0,
    usedTxns: markers,
    offlineRevokedBy: String(actorId || "admin"),
    offlineRevokedAt: Number(now) || Date.now(),
    offlineRevokeRequestId: String(requestId || "")
  };
}

// TxnID কে un-claim করা হয়, কিন্তু রেকর্ডটা মুছে ফেলা হয় না — flagged করে রাখা হয়।
function buildTxnFlagPatch(current, { txnId, userId, requestId, actorId, now }) {
  return {
    ...(current || {}),
    transactionId: String(txnId || current?.transactionId || ""),
    used: false,
    usedBy: "",
    usedAt: 0,
    flagged: true,
    flaggedReason: "offline_payment_revoked_fake",
    flaggedAt: Number(now) || Date.now(),
    flaggedForUser: String(userId || ""),
    flaggedBy: String(actorId || "admin"),
    flaggedRequestId: String(requestId || ""),
    verificationStatus: "fake",
    verificationSource: "admin_revoke"
  };
}

// ইউজারের সব C++ account disable করার প্ল্যান।
function buildBanPlan({ accounts = [], now, reason }) {
  const patches = [];
  for (const account of accounts) {
    const record = account?.record;
    if (!record) continue;
    const status = String(record.status || "active");
    // ইতিমধ্যে ban করা account আবার ban করা হবে না — তবে session বাতিল হবে।
    const alreadyDisabled = status === "disabled";
    patches.push({
      username: String(account.username || ""),
      alreadyDisabled,
      patch: {
        status: "disabled",
        statusBeforeBan: alreadyDisabled ? String(record.statusBeforeBan || "active") : status,
        activeSessionId: null,
        isLoggedIn: false,
        banReason: String(reason || "offline_payment_fraud").slice(0, 200),
        bannedAt: Number(now) || Date.now(),
        banTxnRequestId: String(account.requestId || "")
      }
    });
  }
  return { patches, disabled: patches.length };
}

// ভুল করে ban হলে ফেরানোর প্ল্যান — আগের status ফিরিয়ে দেওয়া হয়।
function buildUnbanPlan({ accounts = [], now }) {
  const patches = [];
  for (const account of accounts) {
    const record = account?.record;
    if (!record) continue;
    const restoreStatus = String(record.statusBeforeBan || "active");
    patches.push({
      username: String(account.username || ""),
      patch: {
        status: restoreStatus === "disabled" ? "active" : restoreStatus,
        statusBeforeBan: null,
        banReason: null,
        bannedAt: 0,
        unbannedAt: Number(now) || Date.now()
      }
    });
  }
  return { patches, restored: patches.length };
}

function describeRevokeOutcome({ request, creditReversed, accountsDisabled, strikes, strikeLimit }) {
  const parts = [
    `🚫 Fake payment হিসেবে mark করা হয়েছে (request \`${String(request?.id || "")}\`)।`,
    creditReversed ? "Session credit ফেরত নেওয়া হয়েছে (totalPaid = 0)।" : "Session credit ফেরত নেওয়ার দরকার হয়নি।",
    accountsDisabled > 0 ? `${accountsDisabled} টি C++ account disable করা হয়েছে।` : "এই ইউজারের কোনো C++ account পাওয়া যায়নি, তাই শুধু strike যোগ হয়েছে।"
  ];
  if (strikes > 0) parts.push(`Strike: **${strikes}/${strikeLimit || 3}**।`);
  return parts.join("\n");
}

module.exports = {
  OFFLINE_FRAUD_REASONS,
  normalizeFraudReason,
  buildSessionRevokePatch,
  buildTxnFlagPatch,
  buildBanPlan,
  buildUnbanPlan,
  describeRevokeOutcome
};
