// Shared Developer-key validity check. Missing/zero expiry means legacy non-expiring key;
// malformed non-empty expiry values fail closed rather than silently disabling expiry.
function isCppKeyUsable(record, now = Date.now()) {
    if (!record || typeof record !== "object" || record.disabled === true || record.revoked === true) return false;
    const rawExpiry = record.expiresAt;
    if (rawExpiry === undefined || rawExpiry === null || rawExpiry === "" || rawExpiry === 0 || rawExpiry === "0") return true;
    const expiry = Number(rawExpiry);
    return Number.isFinite(expiry) && expiry > now;
}

module.exports = { isCppKeyUsable };
