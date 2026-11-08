const DEFAULT_READER_CHECK_LEASE_MS = 60_000;
function claimReaderCheckState(current, provider, token, now = Date.now(), leaseMs = DEFAULT_READER_CHECK_LEASE_MS) {
    if (!current || typeof current !== "object") return undefined;
    const status = String(current.status || "");
    const startedAt = Number(current.readerCheckStartedAt || current.lastReaderCheckAt || 0);
    const staleChecking = status === "checking_reader" && (!startedAt || now - startedAt >= leaseMs);
    if (status !== "select_provider" && !staleChecking) return undefined;
    return { ...current, provider, status: "checking_reader", providerSelectedAt: now, lastReaderCheckAt: now,
        readerCheckStartedAt: now, readerCheckToken: token };
}
function finishReaderCheckState(current, token, patch) {
    if (!current || current.status !== "checking_reader" || current.readerCheckToken !== token) return undefined;
    const { readerCheckToken, readerCheckStartedAt, ...clean } = current;
    return { ...clean, ...patch };
}
function releaseReaderCheckState(current, token, now = Date.now()) {
    if (!current || current.status !== "checking_reader" || current.readerCheckToken !== token) return undefined;
    const { readerCheckToken, readerCheckStartedAt, ...clean } = current;
    return { ...clean, provider: null, status: "select_provider", lastReaderCheckErrorAt: now };
}
module.exports = { claimReaderCheckState, finishReaderCheckState, releaseReaderCheckState };
