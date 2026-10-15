"use strict";

const MAX_RULES = 100;
const MAX_FAQS = 200;
const MAX_EVENTS = 100;

function cleanText(value, max = 1000) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function normalizeStringList(value, maxItems = 30, maxLength = 100) {
  const source = Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[\n,;]+/) : []);
  return [...new Set(source.map(item => cleanText(item, maxLength).toLowerCase()).filter(Boolean))].slice(0, maxItems);
}

function normalizeFaqEntries(raw) {
  const source = Array.isArray(raw) ? raw : Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, value]) => ({ id, ...(value || {}) }));
  return source.slice(0, MAX_FAQS).map((item, index) => ({
    id: cleanText(item?.id || `faq_${index + 1}`, 80),
    question: cleanText(item?.question || item?.q || item?.title, 240),
    answer: cleanText(item?.answer || item?.a || item?.response, 1800),
    keywords: normalizeStringList(item?.keywords || item?.triggers || item?.question || item?.q, 20, 80),
    enabled: item?.enabled !== false
  })).filter(item => item.enabled && item.answer && (item.question || item.keywords.length));
}

function findFaqAnswer(question, rawEntries) {
  const query = cleanText(question, 500).toLocaleLowerCase();
  if (!query) return null;
  const entries = normalizeFaqEntries(rawEntries);
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    const phrase = entry.question.toLocaleLowerCase();
    let score = phrase && (query === phrase ? 100 : query.includes(phrase) ? 50 + Math.min(phrase.length, 40) : phrase.includes(query) ? 25 : 0);
    for (const keyword of entry.keywords) {
      if (keyword.length < 2) continue;
      if (query.includes(keyword)) score = Math.max(score, 10 + Math.min(keyword.length, 30));
    }
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best ? { ...best, score: bestScore } : null;
}

function normalizeKeywordRules(raw) {
  const source = Array.isArray(raw) ? raw : Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, value]) => ({ id, ...(value || {}) }));
  return source.slice(0, MAX_RULES).map((rule, index) => ({
    id: cleanText(rule?.id || `rule_${index + 1}`, 80),
    name: cleanText(rule?.name || `Rule ${index + 1}`, 100),
    type: String(rule?.type || "keyword_reply"),
    keywords: normalizeStringList(rule?.keywords || rule?.keyword, 30, 100),
    reply: cleanText(rule?.reply || rule?.response, 1800),
    enabled: rule?.enabled !== false,
    cooldownSeconds: Math.max(5, Math.min(3600, Number(rule?.cooldownSeconds) || 30)),
    channelIds: normalizeStringList(rule?.channelIds || rule?.channelId, 20, 30).filter(id => /^\d{15,25}$/.test(id))
  })).filter(rule => rule.enabled && rule.type === "keyword_reply" && rule.keywords.length && rule.reply);
}

function matchKeywordRule(content, rules, channelId) {
  const text = cleanText(content, 4000).toLocaleLowerCase();
  if (!text) return null;
  for (const rule of normalizeKeywordRules(rules)) {
    if (rule.channelIds.length && !rule.channelIds.includes(String(channelId))) continue;
    if (rule.keywords.some(keyword => keyword.length >= 2 && text.includes(keyword))) return rule;
  }
  return null;
}

function normalizeTicketRoutes(raw) {
  const source = Array.isArray(raw) ? raw : Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, value]) => ({ id, ...(value || {}) }));
  return source.slice(0, 50).map((route, index) => ({
    id: cleanText(route?.id || `route_${index + 1}`, 80),
    name: cleanText(route?.name || route?.category || `Support ${index + 1}`, 100),
    keywords: normalizeStringList(route?.keywords || [], 30, 80),
    hint: cleanText(route?.hint || route?.description || "", 300),
    supportRoleId: /^\d{15,25}$/.test(String(route?.supportRoleId || "")) ? String(route.supportRoleId) : "",
    enabled: route?.enabled !== false
  })).filter(route => route.enabled && route.keywords.length);
}

function classifyTicketIntent(text, routes) {
  const query = cleanText(text, 2000).toLocaleLowerCase();
  if (!query) return null;
  let best = null, score = 0;
  for (const route of normalizeTicketRoutes(routes)) {
    let current = 0;
    for (const keyword of route.keywords) if (keyword.length >= 2 && query.includes(keyword)) current += Math.min(keyword.length, 24) + 2;
    if (current > score) { best = route; score = current; }
  }
  return best ? { ...best, score } : null;
}

function normalizeEvents(raw) {
  const source = Array.isArray(raw) ? raw : Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, value]) => ({ id, ...(value || {}) }));
  return source.slice(0, MAX_EVENTS).map((event, index) => {
    const startsAt = Number(event?.startsAt || event?.startAt || event?.timestamp) || 0;
    const reminderMinutes = [...new Set((Array.isArray(event?.reminderMinutes) ? event.reminderMinutes : [60, 15, 5]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 10080))].slice(0, 8).sort((a, b) => b - a);
    return {
      id: cleanText(event?.id || `event_${index + 1}`, 80),
      title: cleanText(event?.title || event?.name, 200),
      description: cleanText(event?.description || "", 1000),
      startsAt,
      channelId: /^\d{15,25}$/.test(String(event?.channelId || "")) ? String(event.channelId) : "",
      reminderMinutes,
      notifySubscribers: event?.notifySubscribers === true,
      enabled: event?.enabled !== false,
      createdAt: Number(event?.createdAt) || 0
    };
  }).filter(event => event.title && event.startsAt > 0 && event.reminderMinutes.length);
}

function dueReminderMinutes(event, now) {
  if (!event?.enabled || !Number.isFinite(Number(event.startsAt)) || Number(event.startsAt) <= now) return [];
  const remaining = Number(event.startsAt) - now;
  return (event.reminderMinutes || []).filter(minutes => {
    if (minutes === 0) return remaining <= 30_000 && remaining > 0;
    const target = minutes * 60_000;
    return remaining <= target && remaining > target - 65_000;
  });
}

function getDailyKey(timestamp = Date.now()) {
  const date = new Date(Number(timestamp) || Date.now());
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function calculateRankProgress(record, xpPerLevelBase = 100) {
  const xp = Math.max(0, Number(record?.xp) || 0);
  const level = Math.max(1, Number(record?.level) || 1);
  const needed = Math.max(1, level * Math.max(10, Number(xpPerLevelBase) || 100));
  return { xp, level, needed, percent: Math.max(0, Math.min(100, Math.floor((xp / needed) * 100))) };
}

function normalizeAutomationConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const faq = value.faq && typeof value.faq === "object" ? value.faq : {};
  const onboarding = value.onboarding && typeof value.onboarding === "object" ? value.onboarding : {};
  const suggestions = value.suggestions && typeof value.suggestions === "object" ? value.suggestions : {};
  return {
    enabled: value.enabled !== false,
    faq: {
      enabled: faq.enabled === true,
      channelId: /^\d{15,25}$/.test(String(faq.channelId || "")) ? String(faq.channelId) : "",
      entries: normalizeFaqEntries(faq.entries),
      knowledgeBase: cleanText(faq.knowledgeBase || "", 8000),
      aiFallback: faq.aiFallback === true
    },
    onboarding: {
      enabled: onboarding.enabled !== false,
      dmEnabled: onboarding.dmEnabled === true,
      dmTemplate: cleanText(onboarding.dmTemplate || "স্বাগতম {server}! Rules পড়ে নাও এবং প্রয়োজন হলে !faq বা !tickethelp ব্যবহার করো।", 1600),
      autoRoleIds: normalizeStringList(onboarding.autoRoleIds || [], 10, 30).filter(id => /^\d{15,25}$/.test(id))
    },
    suggestions: {
      enabled: suggestions.enabled !== false,
      channelId: /^\d{15,25}$/.test(String(suggestions.channelId || "")) ? String(suggestions.channelId) : ""
    },
    ticketRoutes: normalizeTicketRoutes(value.ticketRoutes),
    rules: normalizeKeywordRules(value.rules),
    events: normalizeEvents(value.events),
    selfRoles: (Array.isArray(value.selfRoles) ? value.selfRoles : Object.entries(value.selfRoles && typeof value.selfRoles === "object" ? value.selfRoles : {}).map(([id, v]) => ({ roleId: id, ...(v || {}) }))).slice(0, 25).map(item => ({
      roleId: /^\d{15,25}$/.test(String(item?.roleId || item?.id || "")) ? String(item.roleId || item.id) : "",
      label: cleanText(item?.label || item?.name || "Role", 100),
      description: cleanText(item?.description || "", 100)
    })).filter(item => item.roleId && item.label),
    eventChannelId: /^\d{15,25}$/.test(String(value.eventChannelId || "")) ? String(value.eventChannelId) : "",
    raid: { enabled: value.raid?.enabled !== false, joinThreshold: Math.max(4, Math.min(100, Number(value.raid?.joinThreshold) || 8)), windowSeconds: Math.max(5, Math.min(180, Number(value.raid?.windowSeconds) || 30)) }
  };
}

module.exports = {
  cleanText, normalizeStringList, normalizeFaqEntries, findFaqAnswer, normalizeKeywordRules,
  matchKeywordRule, normalizeTicketRoutes, classifyTicketIntent, normalizeEvents, dueReminderMinutes,
  getDailyKey, calculateRankProgress, normalizeAutomationConfig
};
