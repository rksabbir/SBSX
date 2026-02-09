import discord
from discord.ext import commands
from discord import app_commands

# ===== CONFIG =====
TOKEN = "YOUR_BOT_TOKEN"
VERIFY_CHANNEL_ID = 1470266528455987261  # verify channel ID (number)
VERIFIED_ROLE_ID = 1469966592296222761  # verified role ID
UNVERIFIED_ROLE_ID = 1469934005389365300  # unverified role ID (optional)

intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents)

# ===== READY =====
@bot.event
async def on_ready():
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} commands")
    except Exception as e:
        print(e)
    print(f"Bot ready as {bot.user}")

# ===== VERIFY BUTTON VIEW =====
class VerifyView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Verify", style=discord.ButtonStyle.success, custom_id="verify_button")
    async def verify(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        member = interaction.user

        verified_role = guild.get_role(VERIFIED_ROLE_ID)
unverified_role = guild.get_role(UNVERIFIED_ROLE_ID)

        if verified_role in member.roles:
            await interaction.response.send_message("You are already verified!", ephemeral=True)
            return

        if verified_role:
            await member.add_roles(verified_role)
        if unverified_role and unverified_role in member.roles:
            await member.remove_roles(unverified_role)

        # disable button after click
        button.disabled = True
        await interaction.message.edit(view=self)

        await interaction.response.send_message("✅ You are verified!", ephemeral=True)

# ===== SEND VERIFY MESSAGE =====
@bot.tree.command(name="setup_verify", description="Send verify button message")
@app_commands.checks.has_permissions(administrator=True)
async def setup_verify(interaction: discord.Interaction):
    channel = interaction.guild.get_channel(VERIFY_CHANNEL_ID)
    if not channel:
        await interaction.response.send_message("Verify channel ID not found", ephemeral=True)
        return

    embed = discord.Embed(
        title="Server Verification",
        description="Click the button below to get access",
        color=discord.Color.green()
    )
    
    # GIF animation above the button
    embed.set_image(url="https://media.discordapp.net/attachments/1469934304317669509/1470273434469531719/standard.gif?ex=698ab257&is=698960d7&hm=9c6ca30835a9b671153c4f6c9ef8f1a3b103020faf15b2f39c98cef6f5a8461d&=&width=822&height=462")

    await channel.send(embed=embed, view=VerifyView())
    await interaction.response.send_message("Verify system setup done", ephemeral=True)

# ===== AUTO ROLE ON JOIN (DEFAULT UNVERIFIED) =====
@bot.event
async def on_member_join(member):
    unverified_role = member.guild.get_role(UNVERIFIED_ROLE_ID)
    if unverified_role:
        try:
            await member.add_roles(unverified_role, reason="Default unverified on join")
        except discord.Forbidden:
            pass

# ===== SAFETY CHECK: FORCE UNVERIFIED IF NO VERIFIED =====
@bot.event
async def on_member_update(before, after):
    verified_role = after.guild.get_role(VERIFIED_ROLE_ID)
    unverified_role = after.guild.get_role(UNVERIFIED_ROLE_ID)

    if verified_role and unverified_role:
        # If user somehow lost roles and is not verified, force unverified
        if verified_role not in after.roles and unverified_role not in after.roles:
            try:
                await after.add_roles(unverified_role, reason="Force default unverified")
            except discord.Forbidden:
                pass

# ===== BASIC ANTI-LINK =====
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

# ===== AUTO-KICK IF NOT VERIFIED (TIMEOUT) =====
VERIFY_TIMEOUT_SECONDS = 300  # 5 minutes

@bot.event
async def on_member_join(member):
    # give default unverified
    unverified_role = member.guild.get_role(UNVERIFIED_ROLE_ID)
    if unverified_role:
        try:
            await member.add_roles(unverified_role, reason="Default unverified on join")
        except discord.Forbidden:
            pass

    # schedule auto-kick if not verified
    await discord.utils.sleep_until(discord.utils.utcnow() + discord.timedelta(seconds=VERIFY_TIMEOUT_SECONDS))
    verified_role = member.guild.get_role(VERIFIED_ROLE_ID)
    if verified_role and verified_role not in member.roles:
        try:
            await member.kick(reason="Not verified in time")
        except discord.Forbidden:
            pass

# ===== BOT JOIN AUTO-BAN =====
@bot.event
async def on_member_join(member):
    if member.bot:
        try:
            await member.ban(reason="Bot join blocked")
        except discord.Forbidden:
            pass
        return

# ===== BASIC ANTI-RAID (JOIN RATE) =====
join_timestamps = []
RAID_WINDOW = 10  # seconds
RAID_LIMIT = 5   # joins

@bot.event
async def on_member_join(member):
    now = discord.utils.utcnow().timestamp()
    join_timestamps.append(now)
    recent = [t for t in join_timestamps if now - t <= RAID_WINDOW]
    if len(recent) >= RAID_LIMIT:
        try:
            await member.guild.edit(verification_level=discord.VerificationLevel.high)
        except discord.Forbidden:
            pass

# ===== BANGLA VERIFY MESSAGE =====
@bot.tree.command(name="setup_verify_bn", description="বাংলা Verify বাটন সেটআপ")
@app_commands.checks.has_permissions(administrator=True)
async def setup_verify_bn(interaction: discord.Interaction):
    channel = interaction.guild.get_channel(VERIFY_CHANNEL_ID)
    if not channel:
        await interaction.response.send_message("Verify channel ID পাওয়া যায়নি", ephemeral=True)
        return

    embed = discord.Embed(
        title="সার্ভার ভেরিফিকেশন",
        description="নিচের বাটনে ক্লিক করে ভেরিফাই করুন",
        color=discord.Color.green()
    )
    embed.set_image(url="https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif")
    await channel.send(embed=embed, view=VerifyView())
    await interaction.response.send_message("বাংলা Verify সিস্টেম সেটআপ হয়েছে", ephemeral=True)

bot.run(TOKEN)
