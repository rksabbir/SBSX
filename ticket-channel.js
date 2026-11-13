// টিকিট চ্যানেল তৈরির পরিকল্পনা — Discord ছাড়াই যাচাই করা যায় এমন pure helper।
// আগে এই মানগুলো (channelPrefix, permissionOverwrites, supportRoleId) শুধু "অর্ডার
// কনফার্ম" অংশে তৈরি হতো, ফলে create_ বাটনে ReferenceError হতো আর ইউজার ভুলভাবে
// "Manage Channels permission" এরর দেখত। এখন একটাই জায়গা থেকে আসে।

const VIEW = 1024n;          // ViewChannel
const SEND = 2048n;          // SendMessages
const HISTORY = 65536n;      // ReadMessageHistory
const ALLOW_ALL = [VIEW, SEND, HISTORY];

// index.js থেকে inject করা হয় (Discord-এর PermissionFlagsBits আসল value)।
let PERMS = { ViewChannel: VIEW, SendMessages: SEND, ReadMessageHistory: HISTORY };

function configurePermissions(flags = {}) {
  PERMS = {
    ViewChannel: flags.ViewChannel ?? VIEW,
    SendMessages: flags.SendMessages ?? SEND,
    ReadMessageHistory: flags.ReadMessageHistory ?? HISTORY
  };
}

function allowList() {
  return [PERMS.ViewChannel, PERMS.SendMessages, PERMS.ReadMessageHistory];
}

function channelName({ type = "ticket", code, order = false } = {}) {
  const randomCode = Number(code) || Math.floor(1000 + Math.random() * 9000);
  const prefix = order ? "order" : String(type || "ticket").slice(0, 12) || "ticket";
  return `${prefix}-${randomCode}`;
}

/**
 * টিকিট চ্যানেলের নাম, parent আর permission overwrites তৈরি করে।
 * roleExists / configuredRole / moderatorRoles / parentId — সব inject করা হয়,
 * যাতে Discord ক্লায়েন্ট ছাড়াই টেস্ট করা যায়।
 */
function planTicketChannel({
  type = "ticket",
  category = "",
  order = false,
  code,
  guildId = "",
  userId = "",
  parentId = "",
  configuredRole = () => "",
  moderatorRoles = () => [],
  roleExists = () => true
} = {}) {
  const name = channelName({ type, code, order });
  const supportRoleId = String(configuredRole("supportCustomer") || "");
  const supportRoleIds = (moderatorRoles(order ? "orders" : type, supportRoleId ? [supportRoleId] : []) || [])
    .map(value => String(value || ""))
    .filter(Boolean);
  const verifiedRoleId = String(configuredRole("verified") || "");
  const adminRoleId = String(configuredRole("admin") || "");

  const permissionOverwrites = [];
  if (guildId) permissionOverwrites.push({ id: String(guildId), deny: [PERMS.ViewChannel] });
  if (userId) permissionOverwrites.push({ id: String(userId), allow: allowList() });

  // ⚠️ মুছে যাওয়া role দিলে Discord পুরো চ্যানেল তৈরিই ব্যর্থ করে — তাই আগে যাচাই।
  const candidates = [verifiedRoleId, ...supportRoleIds, adminRoleId];
  for (const roleId of candidates) {
    if (!roleId) continue;
    if (!roleExists(roleId)) continue;
    if (permissionOverwrites.some(entry => entry.id === roleId)) continue;
    permissionOverwrites.push(roleId === verifiedRoleId
      ? { id: roleId, deny: [PERMS.ViewChannel] }
      : { id: roleId, allow: allowList() });
  }

  return {
    name,
    permissionOverwrites,
    supportRoleId: roleExists(supportRoleId) ? supportRoleId : "",
    supportRoleIds,
    parentId: parentId || undefined,
    category: String(category || "")
  };
}

/** চ্যানেল তৈরি ব্যর্থ হলে ইউজারকে আসল কারণ দেখানো — সব সময় "permission" বলা ঠিক নয়। */
function describeChannelCreateError(err) {
  const message = String(err?.message || "");
  const code = Number(err?.code);
  let hint;
  if (/missing permissions/i.test(message) || code === 50013) {
    hint = "Bot-এর **Manage Channels** অনুমতি নেই — সার্ভার role এবং প্যানেলের ক্যাটাগরি দুটোতেই চেক করুন";
  } else if (/missing access/i.test(message) || code === 50001) {
    hint = "বটের ওই ক্যাটাগরিতে ঢোকার অনুমতি নেই (**View Channels** দিন)";
  } else if (/maximum number of channels|channel count|maximum number of guild channels/i.test(message)) {
    hint = "সার্ভারে চ্যানেলের সীমা (৫০০) শেষ — পুরোনো টিকিট/চ্যানেল মুছুন";
  } else if (/unknown channel|unknown guild/i.test(message) || code === 10003 || code === 10004) {
    hint = "ক্যাটাগরি বা সার্ভার পাওয়া যাচ্ছে না — প্যানেলটি নতুন ক্যাটাগরিতে বসান";
  } else if (/invalid form body/i.test(message)) {
    hint = `Discord অনুরোধ গ্রহণ করেনি (${message.slice(0, 120)})`;
  } else {
    hint = message ? message.slice(0, 180) : "অজানা কারণ";
  }
  return `❌ টিকিট চ্যানেল তৈরি হয়নি — ${hint}।`;
}

module.exports = { planTicketChannel, channelName, describeChannelCreateError, configurePermissions };
