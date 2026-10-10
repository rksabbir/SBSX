// Shared in-process duplicate-submit guard state for TxnID modal submissions.
const paymentTxnLocks = new Set();
const paymentTxnLastAt = new Map();
module.exports = { paymentTxnLocks, paymentTxnLastAt };
