const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('account creation validates database payment evidence before it claims the checkout', () => {
  const validationAt = source.indexOf('const eligibility = await validateCheckoutPayment(initialSession, userId, category)');
  const claimAt = source.indexOf('const claimResult = await sessionRef.transaction', validationAt);
  assert.ok(validationAt > 0);
  assert.ok(claimAt > validationAt);
  assert.match(source, /checkoutFingerprint\(current\) !== validatedFingerprint/);
});

test('free coupon sessions require successful coupon consumption before proof is written', () => {
  assert.match(source, /if \(!couponConsumption\.committed\)[\s\S]{0,450}free checkout খোলা হয়নি/);
  assert.match(source, /couponConsumeCommitted: true/);
  assert.match(source, /freeCheckoutProof/);
});

test('ticket and order channel creation applies the panel channel category as parent', () => {
  assert.equal((source.match(/parent: getSourceParentCategoryId\(interaction\)/g) || []).length, 2);
  assert.match(source, /function getSourceParentCategoryId\(interaction\)/);
});

test('panel commands replace existing bot-owned panels instead of making duplicates', () => {
  assert.match(source, /async function sendReplacingBotPanel/);
  assert.match(source, /previousPanels[\s\S]{0,300}oldMessage\.delete\(\)/);
  assert.match(source, /message\.content === "!ticket"[\s\S]{0,180}sendReplacingBotPanel/);
});
