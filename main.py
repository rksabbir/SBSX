import os
import asyncio
import discord
from discord.ext import commands
from discord import app_commands

# ================= CONFIG =================
TOKEN = os.getenv("TOKEN")  # Bot Token from Railway Variables

VERIFY_CHANNEL_ID = 1470266528455987261  # VERIFY channel ID
VERIFIED_ROLE_ID = 1469966592296222761  # Verified role ID
UNVERIFIED_ROLE_ID = 1469934005389365300  # Unverified role ID
VERIFY_TIMEOUT_SECONDS = 300  # 5 minutes
RAID_WINDOW = 10  # seconds
RAID_LIMIT = 5   # joins in window

# =========================================
intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents)
join_timestamps = []

# ================= READY =================
@bot.event
async def on_ready():
    try:
        await bot.tree.sync()
    except Exception:
        pass
    print(f"Bot online as {bot.user}")

# ================= VERIFY VIEW =================
class VerifyView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Verify", style=discord.ButtonStyle.success)
    async def verify(self, interaction: discord.Interaction, button: discord.ui.Button):
        member = interaction.user
        guild = interaction.guild

        verified_role = guild.get_role(VERIFIED_ROLE_ID)
        unverified_role = guild.get_role(UNVERIFIED_ROLE_ID)

        if verified_role in member.roles:
            await interaction.response.send_message("Already verified", ephemeral=True)
            return

        if verified_role:
            await member.add_roles(verified_role)
        if unverified_role and unverified_role in member.roles:
            await member.remove_roles(unverified_role)

        button.disabled = True
        await interaction.message.edit(view=self)
        await interaction.response.send_message("✅ You are verified!", ephemeral=True)

# ================= SETUP VERIFY =================
@bot.tree.command(name="setup_verify", description="Send verify button message")
@app_commands.checks.has_permissions(administrator=True)
async def setup_verify(interaction: discord.Interaction):
    channel = interaction.guild.get_channel(VERIFY_CHANNEL_ID)
    if not channel:
        await interaction.response.send_message("Verify channel not found", ephemeral=True)
        return

    embed = discord.Embed(
        title="Server Verification",
        description="Click the button below to get access",
        color=discord.Color.green()
    )
    embed.set_image(url="https://cdn.discordapp.com/attachments/1469934304317669509/1470273434469531719/standard.gif?ex=698ab257&is=698960d7&hm=9c6ca30835a9b671153c4f6c9ef8f1a3b103020faf15b2f39c98cef6f5a8461d")
    await channel.send(embed=embed, view=VerifyView())
    await interaction.response.send_message("Verify system setup done", ephemeral=True)

# ================= AUTO ROLE & VERIFY =================
@bot.event
async def on_member_join(member):
    # Default unverified
    unverified_role = member.guild.get_role(UNVERIFIED_ROLE_ID)
    if unverified_role:
        try:
            await member.add_roles(unverified_role, reason="Default unverified on join")
        except discord.Forbidden:
            pass

    # Auto-kick if not verified in time
    await asyncio.sleep(VERIFY_TIMEOUT_SECONDS)
    verified_role = member.guild.get_role(VERIFIED_ROLE_ID)
    if verified_role and verified_role not in member.roles:
        try:
            await member.kick(reason="Not verified in time")
        except discord.Forbidden:
            pass

    # Bot join auto-ban
    if member.bot:
        try:
            await member.ban(reason="Bot join blocked")
        except discord.Forbidden:
            pass
        return

    # Anti-raid
    join_timestamps.append(member.joined_at.timestamp())
    now = member.joined_at.timestamp()
    recent = [t for t in join_timestamps if now - t <= RAID_WINDOW]
    if len(recent) >= RAID_LIMIT:
        try:
            await member.guild.edit(verification_level=discord.VerificationLevel.high)
        except discord.Forbidden:
            pass

# ================= ANTI-LINK =================
@bot.event
async def on_message(message):
    if message.author.bot:
        return

    blocked = ["discord.gg", "http://", "https://"]
    if any(x in message.content.lower() for x in blocked):
        if not message.author.guild_permissions.administrator:
            await message.delete()
            await message.channel.send(f"{message.author.mention} links not allowed")
            return

    await bot.process_commands(message)

# ================= RUN BOT =================
bot.run(TOKEN)
