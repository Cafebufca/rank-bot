// commands/price.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

// ====== IDs (hardcoded as requested) ======
const COMMAND_CHANNEL_ID = "1455724333333745796";
const STAFF_LOG_CHANNEL_ID = "1455724718970634261";
const STAFF_ROLE_ID = "1454948532879491153";

// ====== Rank ladder (lowest -> highest) ======
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

const rankChoices = RANKS.map((r) => ({ name: r, value: r }));

// ====== Pricing rules ======
// Step cost starts at 100 for the first step (Bronze 1 -> Bronze 2),
// then increases by +10 for each next step up the ladder.
// stepCost(i) is the cost to go from RANKS[i] -> RANKS[i+1]
function stepCost(i) {
  return 100 + 10 * i;
}

function calcNetPrice(fromIndex, toIndex) {
  let total = 0;
  for (let i = fromIndex; i < toIndex; i++) total += stepCost(i);
  return total;
}

// Roblox "tax" helper: to receive NET Robux, buyer must pay GROSS via gamepass
// Roblox typically pays out 70% to seller (30% fee).
function grossFromNet(net) {
  return Math.ceil(net / 0.7);
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

const RESPECT_TEXT =
  "Keep in mind that our employees/boosters spend the time they should be doing other stuff in to come and help you. " +
  "Please be respectful and abide by the rules. You must pay first using a gamepass, and then we will start the boosting process. " +
  "If our employees need to leave, do not argue, as it is up to them if they want to leave. Enjoy your boosting!";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("price")
    .setDescription("Get a quote for a rank up (tiered pricing + Roblox tax estimate).")
    .addStringOption((option) =>
      option
        .setName("rank")
        .setDescription("Your current rank")
        .setRequired(true)
        .addChoices(...rankChoices)
    )
    .addStringOption((option) =>
      option
        .setName("to")
        .setDescription("Rank you want to reach")
        .setRequired(true)
        .addChoices(...rankChoices)
    ),

  async execute(interaction) {
    // Restrict to command channel
    if (interaction.channelId !== COMMAND_CHANNEL_ID) {
      return interaction.reply({
        content: `❌ Please use this command in <#${COMMAND_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const fromRank = interaction.options.getString("rank");
    const toRank = interaction.options.getString("to");

    const fromIndex = RANKS.indexOf(fromRank);
    const toIndex = RANKS.indexOf(toRank);

    if (fromIndex === -1 || toIndex === -1) {
      return interaction.reply({
        content: "❌ Invalid rank selection. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const levels = toIndex - fromIndex;
    if (levels <= 0) {
      return interaction.reply({
        content: `❌ Target rank must be higher than current.\nYou selected **${fromRank} → ${toRank}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Calculate pricing
    const net = calcNetPrice(fromIndex, toIndex);
    const gross = grossFromNet(net);

    // For transparency, show first/last step cost
    const firstStep = stepCost(fromIndex);
    const lastStep = stepCost(toIndex - 1);

    // Confirmation buttons (index.js will handle these customIds)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("✅ Confirm Price")
        .setStyle(ButtonStyle.Success)
        .setCustomId(
          // encode the quote in the button id (kept short; index.js will parse this)
          `price_confirm:${fromIndex}:${toIndex}:${net}:${gross}:${levels}`
        ),
      new ButtonBuilder()
        .setLabel("❌ Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setCustomId("price_cancel")
    );

    // Initial quote (private)
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `📈 **Price Quote**\n\n` +
        `• **From:** ${fromRank}\n` +
        `• **To:** ${toRank}\n` +
        `• **Steps:** ${levels}\n\n` +
        `🧾 **Tiered pricing:** first step **${fmt(firstStep)}**, last step **${fmt(lastStep)}** (increases by +10 each step)\n\n` +
        `💰 **Total (net): ${fmt(net)} Robux**\n` +
        `🧾 **Gamepass price (est. w/ Roblox fee): ${fmt(gross)} Robux**\n\n` +
        `⏳ After you open a ticket, staff will send the gamepass link within **1–2 minutes**.\n\n` +
        `${RESPECT_TEXT}\n\n` +
        `✅ Click **Confirm Price** to proceed and open a ticket.\n` +
        `⏳ *This message will disappear in 60 seconds.*`,
      components: [row],
    });

    // Auto-delete after 60 seconds
    setTimeout(async () => {
      try {
        await interaction.deleteReply();
      } catch {}
    }, 60_000);

    // Staff log (optional)
    try {
      const staffChannel = await interaction.client.channels
        .fetch(STAFF_LOG_CHANNEL_ID)
        .catch(() => null);

      if (staffChannel?.isTextBased()) {
        const staffPing = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : "";
        await staffChannel.send(
          `🧾 **Price Quote Requested** ${staffPing}\n` +
            `👤 User: ${interaction.user.tag}\n` +
            `📍 Channel: <#${interaction.channelId}>\n` +
            `📊 ${fromRank} → ${toRank} (${levels} steps)\n` +
            `💰 Net: ${fmt(net)} | Gamepass (est): ${fmt(gross)}`
        );
      }
    } catch {
      // ignore logging failures
    }
  },
};
