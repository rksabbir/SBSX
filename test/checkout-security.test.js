const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCheckoutEligibility,
  checkoutFingerprint,
  resolveParentCategoryId
} = require('../checkout-security');

const paidSession = {
  createdByDiscordId: 'user-1',
  status: 'pending',
  category: 'weekly',
  provider: 'bkash',
  appliedDiscount: 0,
  basePrice: 100,
  targetPrice: 100,
  totalPaid: 100,
  usedTxns: ['TXN-123']
};
const verifiedTransactions = {
  'TXN-123': {
    amount: 100,
    verificationStatus: 'verified',
    verificationSource: 'manual_admin_review',
    provider: 'bkash',
    used: true,
    usedBy: 'user-1'
  }
};

test('allows a checkout only when transaction record is verified, used, and owned by buyer', () => {
  assert.equal(evaluateCheckoutEligibility({ session: paidSession, userId: 'user-1', category: 'weekly', transactions: verifiedTransactions }).ok, true);
});

test('blocks a splash/button-only attempt with no verified transaction record', () => {
  const result = evaluateCheckoutEligibility({ session: paidSession, userId: 'user-1', category: 'weekly', transactions: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transaction_unverified_or_not_owned');
});

test('blocks transaction proof that belongs to another buyer', () => {
  const result = evaluateCheckoutEligibility({
    session: paidSession,
    userId: 'user-1',
    category: 'weekly',
    transactions: { 'TXN-123': { ...verifiedTransactions['TXN-123'], usedBy: 'user-2' } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transaction_unverified_or_not_owned');
});

test('blocks paid-total mismatch and tampered totals', () => {
  const result = evaluateCheckoutEligibility({
    session: { ...paidSession, totalPaid: 500 },
    userId: 'user-1', category: 'weekly', transactions: verifiedTransactions
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'paid_total_mismatch');
});

test('blocks zero-price checkout unless a full-value coupon was actually consumed', () => {
  const result = evaluateCheckoutEligibility({
    session: { ...paidSession, targetPrice: 0, appliedDiscount: 100, totalPaid: 0, usedTxns: ['COUPON_100_PERCENT_OFF'] },
    userId: 'user-1', category: 'weekly'
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'free_checkout_unproven');
});

test('allows free checkout with matching full-value coupon consumption proof', () => {
  const result = evaluateCheckoutEligibility({
    session: {
      ...paidSession,
      targetPrice: 0,
      appliedDiscount: 100,
      totalPaid: 0,
      usedTxns: ['COUPON_100_PERCENT_OFF'],
      freeCheckoutProof: {
        type: 'coupon', couponCode: 'AK-ABC123', userId: 'user-1', category: 'weekly',
        basePrice: 100, discount: 100, consumedAt: Date.now(), couponConsumeCommitted: true
      }
    },
    userId: 'user-1', category: 'weekly'
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'coupon_free');
});

test('blocks changed checkout price/discount that do not add up', () => {
  const result = evaluateCheckoutEligibility({
    session: { ...paidSession, targetPrice: 1 },
    userId: 'user-1', category: 'weekly', transactions: verifiedTransactions
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'price_mismatch');
});

test('blocks a verified transaction from the wrong payment provider', () => {
  const result = evaluateCheckoutEligibility({
    session: paidSession, userId: 'user-1', category: 'weekly',
    transactions: { 'TXN-123': { ...verifiedTransactions['TXN-123'], provider: 'nagad' } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'provider_mismatch');
});

test('offline payment requires a matching approved staff request', () => {
  const session = { ...paidSession, status: 'offline_payment_approved', offlinePaymentRequestId: 'req-1', offlineApprovedBy: 'staff-1', offlineApprovedAt: 1000 };
  const denied = evaluateCheckoutEligibility({ session, userId: 'user-1', category: 'weekly' });
  assert.equal(denied.ok, false);
  const allowed = evaluateCheckoutEligibility({
    session, userId: 'user-1', category: 'weekly',
    offlineRequest: { status: 'approved', checkoutKey: 'user-1_weekly', reviewedBy: 'staff-1', amount: 100 }
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.method, 'offline_admin_approved');
});

test('payment fingerprint changes when the session value changes after validation', () => {
  assert.notEqual(checkoutFingerprint(paidSession), checkoutFingerprint({ ...paidSession, targetPrice: 1 }));
});

test('ticket channel uses only a real parent category', () => {
  assert.equal(resolveParentCategoryId({ parentId: 'category-1', parentType: 4 }, 4), 'category-1');
  assert.equal(resolveParentCategoryId({ parentId: 'text-channel', parentType: 0 }, 4), undefined);
  assert.equal(resolveParentCategoryId({ parentId: null, parentType: 4 }, 4), undefined);
});
