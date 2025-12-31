const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const PRICE_PER_LEVEL = 50;

// ✅ Your IDs
const ALLOWED_CHANNEL_ID = "1455724333333745796";
const STAFF_LOG_CHANNEL_ID = "1455724718970634261";

// ⏱ Cooldown
const COOLDOWN_MS = 60_000;

const RANKS = [
  "Bronze 1", "Bronze 2", "Bronze 3",
  "Silver 1", "Silver 2", "Silver 3",
  "Gold 1", "Gold 2", "Gold 3",
  "Platinum 1", "Platinum 2", "Platinum 3",
  "Diamond 1", "Diamond 2", "Diamond 3",
  "Onyx 1", "Onyx 2", "Onyx 3",
  "Nemesis",
  "Archnemesis",
];

const rankChoices = RANKS.map(r => ({ name: r, value: r }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("price")
    .setDescription("Calculate the Robux cost to rank up.")
    .addStringOption(option =>
      option
        .setName("rank")
        .setDescription("Your current rank")
        .setRequired(true)
        .addChoices(...rankChoices)
    )
    .addStringOption(option =>
      option
        .setName("to")
        .setDescription("Rank you want to reach")
        .setRequired(true)
        .addChoices(...rankChoices)
    ),

  async execute(interaction) {
    // 📍 Channel restriction
    if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
      return interaction.reply({
        content: "❌ Please use this command in the designated pricing channel.",
        ephemeral: true,
      });
    }

    // Create cooldown store + quotes store once
    if (!interaction.client.cooldowns) interaction.client.cooldowns = new Map();
    if (!interaction.client.priceQuotes) interaction.client.priceQuotes = new Map();

    // ⏱ Cooldown check (per user)
    const now = Date.now();
    const last = interaction.client.cooldowns.get(interaction.user.id) || 0;
    const remaining = COOLDOWN_MS - (now - last);

    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      return interaction.reply({
        content: `⏳ Please wait **${seconds}s** before requesting another price.`,
        ephemeral: true,
      });
    }

    // Set cooldown timestamp immediately
    interaction.client.cooldowns.set(interaction.user.id, now);

    await interaction.deferReply({ ephemeral: true });

    const fromRank = interaction.options.getString("rank");
    const toRank = interaction.options.getString("to");

    const fromIndex = RANKS.indexOf(fromRank);
    const toIndex = RANKS.indexOf(toRank);
    const levels = toIndex - fromIndex;

    if (levels <= 0) {
      return interaction.editReply(
        `❌ Target rank must be higher than current.\nYou selected **${fromRank} → ${toRank}**.`
      );
    }

    const price = levels * PRICE_PER_LEVEL;

    // Store quote for ticket flow
    interaction.client.priceQuotes.set(interaction.user.id, {
      fromRank,
      toRank,
      levels,
      price,
      createdAt: now,
    });

    // 🛒 Button: Open Ticket
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("🛒 Open Ticket")
        .setStyle(ButtonStyle.Primary)
        .setCustomId("open_ticket")
    );

    await interaction.editReply({
      content:
        `📈 **Price Calculation**\n\n` +
        `• **From:** ${fromRank}\n` +
        `• **To:** ${toRank}\n` +
        `• **Levels:** ${levels}\n\n` +
        `💰 **Total:** **${price} Robux**\n\n` +
        `⏳ *This message will disappear in 60 seconds.*`,
      components: [row],
    });

    // 🧾 Staff log
    const staffChannel = await interaction.client.channels
      .fetch(STAFF_LOG_CHANNEL_ID)
      .catch(() => null);

    if (staffChannel) {
      staffChannel.send(
        `🧾 **Price Request Log**\n` +
        `👤 User: ${interaction.user.tag} (${interaction.user.id})\n` +
        `📍 Channel: <#${interaction.channelId}>\n` +
        `📊 ${fromRank} → ${toRank} (${levels} levels)\n` +
        `💰 Price: ${price} Robux`
      ).catch(() => {});
    } else {
      console.log("⚠️ Staff log channel not accessible by bot (permissions or wrong ID).");
    }

    // ⏱ Auto-delete after 60 seconds
    setTimeout(async () => {
      try {
        await interaction.deleteReply();
      } catch {}
    }, 60_000);
  },
};
