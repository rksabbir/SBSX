// Offline payment request review decision rules.
// Kept side-effect free so the approve/reject wiring in index.js can be unit tested.

const OFFLINE_REVIEW_OPEN_STATUSES = ["pending", "needs_staff_channel"];

function isOpenOfflineReviewStatus(status) {
  return OFFLINE_REVIEW_OPEN_STATUSES.includes(String(status || ""));
}

// কোনো request এখন review (approve/reject) করা যাবে কি না, আর না গেলে কেন।
// `action` হলো "approve" | "reject"; `request` হলো Firebase থেকে পড়া রেকর্ড (নাও থাকতে পারে)।
function getOfflineReviewDecision({ action, request }) {
  if (!request) return { allowed: false, reason: "not_found" };
  const status = String(request.status || "");

  if (status === "approved" || status === "approved_but_session_changed") {
    if (action === "approve") return { allowed: true, reason: "already_approved_self_heal", idempotent: true };
    return { allowed: false, reason: "already_approved" };
  }
  if (status === "rejected") {
    if (action === "reject") return { allowed: false, reason: "already_rejected", idempotent: true };
    return { allowed: false, reason: "already_rejected_blocks_approve" };
  }
  if (status === "expired") return { allowed: false, reason: "expired" };
  if (isOpenOfflineReviewStatus(status)) return { allowed: true, reason: "review_now" };
  return { allowed: false, reason: "unexpected_status", status };
}

// checkout session / deadline দেখে stale offline request expire করা উচিত কি না।
// deadlineMs হলো checkout.sessionExpiryHours * 60 * 60 * 1000।
function shouldExpireOfflineRequest({ request, session, now, deadlineMs }) {
  if (!request || !isOpenOfflineReviewStatus(request.status)) return false;
  const createdAt = Number(request.createdAt) || 0;
  const deadlinePassed = createdAt > 0 && Number(now) - createdAt > Number(deadlineMs);
  const sessionExpired = String(session?.status || "") === "expired";
  const sessionUnpaid = (Number(session?.totalPaid) || 0) <= 0;
  if (sessionExpired) return true;
  return deadlinePassed && (sessionUnpaid || !session);
}

function describeReviewer(record) {
  const id = record?.reviewedBy ? String(record.reviewedBy) : "";
  if (id) return `<@${id}>`;
  const name = record?.reviewedByUsername ? String(record.reviewedByUsername) : "";
  return name ? `\`${name}\`` : "অন্য একজন Admin/Staff";
}

function describeReviewedAt(record) {
  const at = Number(record?.reviewedAt) || 0;
  return at > 0 ? ` (<t:${Math.floor(at / 1000)}:R>)` : "";
}

module.exports = {
  OFFLINE_REVIEW_OPEN_STATUSES,
  isOpenOfflineReviewStatus,
  getOfflineReviewDecision,
  shouldExpireOfflineRequest,
  describeReviewer,
  describeReviewedAt
};
