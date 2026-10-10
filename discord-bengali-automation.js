"use strict";
function escapeDiscordText(value, maxLength = 100) {
  return String(value ?? "").replace(/@/g, "@\u200b").replace(/[<>`*_~|]/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function sanitizeVoiceSpeech(value, maxLength = 180) {
  return String(value ?? "").normalize("NFC")
    .replace(/<@!?\d{15,25}>|<@&\d{15,25}>|<#\d{15,25}>/g, " ")
    .replace(/@(everyone|here)\b/gi, " $1 ").replace(/@/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[<>`*_~|\\]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}
function formatVerifiedAnnouncement(memberId) {
  return `🎉 **নতুন সদস্য ভেরিফাইড!**\n👤 সদস্য: <@${String(memberId || "")}>\n✅ স্ট্যাটাস: **Verified**`;
}
function formatRoleChangeAnnouncement({ memberId, roleName, action }) {
  const role = escapeDiscordText(roleName, 100) || "Unknown role";
  if (action === "remove") return `➖ **রোল আপডেট**\n👤 সদস্য: <@${String(memberId || "")}>\n🧹 সরানো হয়েছে: **${role}**`;
  return `🎖️ **রোল আপডেট**\n👤 সদস্য: <@${String(memberId || "")}>\n✅ নতুন রোল পেয়েছেন: **${role}**`;
}
function formatLevelUpAnnouncement(memberId, level) {
  const safeLevel = Math.max(1, Math.min(100000, Math.floor(Number(level) || 1)));
  return `🚀 **লেভেল আপ রিওয়ার্ড!**\n🎉 অভিনন্দন <@${String(memberId || "")}>!\n🏆 আপনার নতুন লেভেল: **${safeLevel}**`;
}
module.exports = { escapeDiscordText, sanitizeVoiceSpeech, formatVerifiedAnnouncement, formatRoleChangeAnnouncement, formatLevelUpAnnouncement };
