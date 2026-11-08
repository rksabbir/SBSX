'use strict';

const FREE_CHECKOUT_MARKERS = new Set([
  'AUTO_COUPON_100_PERCENT_OFF',
  'COUPON_100_PERCENT_OFF'
]);
const VERIFIED_SOURCES = new Set(['official_api', 'manual_admin_review']);

function isSpecialPaymentMarker(value) {
  const text = String(value || '');
  return FREE_CHECKOUT_MARKERS.has(text) || text.startsWith('OFFLINE_ADMIN_APPROVED:');
}

function evaluateCheckoutEligibility({ session, userId, category, transactions = {}, offlineRequest = null }) {
  if (!session || typeof session !== 'object') return { ok: false, reason: 'missing_session' };
  if (!userId || String(session.createdByDiscordId || '') !== String(userId)) return { ok: false, reason: 'wrong_owner' };
  if (['creating', 'completed', 'expired', 'offline_payment_rejected'].includes(String(session.status || ''))) {
    return { ok: false, reason: 'session_not_usable' };
  }

  const targetPrice = Number(session.targetPrice);
  const basePrice = Number(session.basePrice);
  const totalPaid = Number(session.totalPaid) || 0;
  const appliedDiscount = Number(session.appliedDiscount) || 0;
  if (!Number.isFinite(targetPrice) || targetPrice < 0 || !Number.isFinite(basePrice) || basePrice <= 0 ||
      !Number.isFinite(appliedDiscount) || appliedDiscount < 0 || appliedDiscount > basePrice + 0.011 || totalPaid < 0) {
    return { ok: false, reason: 'invalid_price' };
  }
  if (Math.abs(Math.max(0, basePrice - appliedDiscount) - targetPrice) > 0.011) {
    return { ok: false, reason: 'price_mismatch' };
  }

  if (session.status === 'offline_payment_approved') {
    const requestId = String(session.offlinePaymentRequestId || '');
    const validRequest = requestId && offlineRequest && offlineRequest.status === 'approved' &&
      String(offlineRequest.checkoutKey || '') === `${userId}_${category}` &&
      String(offlineRequest.reviewedBy || '') === String(session.offlineApprovedBy || '') &&
      Number(offlineRequest.amount) >= targetPrice &&
      Number(session.offlineApprovedAt) > 0;
    return validRequest
      ? { ok: true, method: 'offline_admin_approved' }
      : { ok: false, reason: 'offline_approval_invalid' };
  }

  if (targetPrice === 0) {
    const proof = session.freeCheckoutProof;
    const validProof = proof && proof.type === 'coupon' && proof.couponConsumeCommitted === true &&
      String(proof.userId || '') === String(userId) && String(proof.category || '') === String(category) &&
      String(proof.couponCode || '').length >= 3 && Number(proof.consumedAt) > 0 &&
      Number(proof.basePrice) >= basePrice && Number(proof.discount) >= basePrice;
    return validProof ? { ok: true, method: 'coupon_free' } : { ok: false, reason: 'free_checkout_unproven' };
  }

  if (totalPaid < targetPrice) return { ok: false, reason: 'payment_incomplete' };
  const usedTxns = Array.isArray(session.usedTxns) ? session.usedTxns : [];
  const txnIds = usedTxns.map(String).filter(id => id && !isSpecialPaymentMarker(id));
  if (txnIds.length === 0) return { ok: false, reason: 'no_verified_transaction_ids' };

  let verifiedTotal = 0;
  for (const txnId of txnIds) {
    const txn = transactions[txnId];
    if (!txn || txn.verificationStatus !== 'verified' || !VERIFIED_SOURCES.has(String(txn.verificationSource || '')) ||
        txn.used !== true || String(txn.usedBy || '') !== String(userId)) {
      return { ok: false, reason: 'transaction_unverified_or_not_owned' };
    }
    if (!['bkash', 'nagad'].includes(String(session.provider || '').toLowerCase()) ||
        String(txn.provider || '').toLowerCase() !== String(session.provider || '').toLowerCase()) {
      return { ok: false, reason: 'provider_mismatch' };
    }
    const amount = Number(txn.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid_transaction_amount' };
    verifiedTotal += amount;
  }
  if (Math.abs(verifiedTotal - totalPaid) > 0.011) return { ok: false, reason: 'paid_total_mismatch' };
  if (verifiedTotal + 0.009 < targetPrice) return { ok: false, reason: 'verified_amount_insufficient' };
  return { ok: true, method: 'verified_transactions', verifiedTotal };
}

function checkoutFingerprint(session) {
  if (!session || typeof session !== 'object') return '';
  return JSON.stringify({
    status: session.status,
    createdByDiscordId: session.createdByDiscordId,
    targetPrice: session.targetPrice,
    basePrice: session.basePrice,
    totalPaid: session.totalPaid,
    usedTxns: Array.isArray(session.usedTxns) ? session.usedTxns : [],
    appliedCoupon: session.appliedCoupon || null,
    appliedDiscount: session.appliedDiscount || 0,
    freeCheckoutProof: session.freeCheckoutProof || null,
    offlinePaymentRequestId: session.offlinePaymentRequestId || null,
    offlineApprovedBy: session.offlineApprovedBy || null,
    offlineApprovedAt: session.offlineApprovedAt || null
  });
}

function resolveParentCategoryId(sourceChannel, categoryType = 4) {
  const parentId = sourceChannel && sourceChannel.parentId ? String(sourceChannel.parentId) : '';
  if (!parentId) return undefined;
  const parentType = sourceChannel.parentType;
  if (parentType !== categoryType) return undefined;
  return parentId;
}

module.exports = { evaluateCheckoutEligibility, checkoutFingerprint, resolveParentCategoryId, isSpecialPaymentMarker };
