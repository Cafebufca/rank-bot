const { SlashCommandBuilder } = require("discord.js");

const PRICE_PER_LEVEL = 50;

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
    .setDescription("Calculate Robux cost to rank up (50 Robux per level).")
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
    const fromRank = interaction.options.getString("rank");
    const toRank = interaction.options.getString("to");

    const fromIndex = RANKS.indexOf(fromRank);
    const toIndex = RANKS.indexOf(toRank);

    const levels = toIndex - fromIndex;

    if (levels <= 0) {
      return interaction.reply({
        content: `❌ Target rank must be higher than current.\nYou selected **${fromRank} → ${toRank}**.`,
        ephemeral: true,
      });
    }

    const price = levels * PRICE_PER_LEVEL;

    return interaction.reply({
      content: `The price for this rank up will be **${price} Robux** (**${levels} levels**).`,
      ephemeral: true,
    });
  },
};
