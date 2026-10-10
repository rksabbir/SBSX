// Bound the transaction-submit cooldown so configuration mistakes cannot disable
// the anti-spam guard or accidentally lock a checkout for an unreasonable duration.
function getPaymentTxnSubmitCooldownMs(rawValue) {
    const parsed = Number(rawValue);
    const candidate = rawValue === undefined || rawValue === null || rawValue === "" || !Number.isFinite(parsed)
        ? 15_000
        : parsed;
    return Math.max(1_000, Math.min(300_000, Math.floor(candidate)));
}

module.exports = { getPaymentTxnSubmitCooldownMs };
