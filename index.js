const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
require("dotenv").config();

// ✅ Your IDs
const STAFF_ROLE_ID = "1454948532879491153";
const TICKET_CATEGORY_ID = "1455736127955931272";

// Seller Roblox account
const ROBLOX_SELLER_USERNAME = "dillionsusurupzenoi";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Stores
client.cooldowns = new Map();
client.priceQuotes = new Map();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data?.name || typeof command.execute !== "function") {
    console.log(`⚠️ Skipping invalid command file: ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

client.once("ready", () => console.log(`✅ Logged in as ${client.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    // Button click: Open Ticket
    if (interaction.isButton() && interaction.customId === "open_ticket") {
      const quote = client.priceQuotes.get(interaction.user.id);
      if (!quote) {
        return interaction.reply({
          content: "❌ I couldn’t find your price quote. Please run `/price` again.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("ticket_modal")
        .setTitle("Create Ticket");

      const robloxInput = new TextInputBuilder()
        .setCustomId("roblox_username")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Enter your Roblox username")
        .setRequired(true)
        .setMaxLength(40);

      modal.addComponents(new ActionRowBuilder().addComponents(robloxInput));
      await interaction.showModal(modal);
      return;
    }

    // Modal submit: create ticket channel
    if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {
      const robloxUsername = interaction.fields
        .getTextInputValue("roblox_username")
        ?.trim();

      const quote = client.priceQuotes.get(interaction.user.id);

      if (!quote) {
        return interaction.reply({
          content: "❌ I couldn’t find your price quote. Please run `/price` again.",
          ephemeral: true,
        });
      }

      // Prevent duplicate tickets (optional but helpful)
      const existing = interaction.guild.channels.cache.find(
        ch =>
          ch.type === ChannelType.GuildText &&
          ch.name.startsWith("ticket-") &&
          ch.topic === `ticket_owner:${interaction.user.id}`
      );
      if (existing) {
        return interaction.reply({
          content: `⚠️ You already have an open ticket: <#${existing.id}>`,
          ephemeral: true,
        });
      }

      const safeName = (robloxUsername || "user")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 30);

      const channelName = `ticket-${safeName}`;

      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: STAFF_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ];

      const ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        topic: `ticket_owner:${interaction.user.id}`,
        permissionOverwrites: overwrites,
      });

      await ticketChannel.send(
        `🎟️ **Ticket Created**\n\n` +
        `👤 Discord: <@${interaction.user.id}>\n` +
        `🎮 Roblox Username: **${robloxUsername || "N/A"}**\n\n` +
        `📈 Rank Up: **${quote.fromRank} → ${quote.toRank}** (**${quote.levels} levels**)\n` +
        `💰 Amount Due: **${quote.price} Robux**\n\n` +
        `✅ **Payment Instructions**\n` +
        `1) Purchase the gamepass for **${quote.price} Robux**\n` +
        `2) Buy it from the Roblox account: **${ROBLOX_SELLER_USERNAME}**\n` +
        `3) After purchase, reply here with proof (screenshot / transaction info).\n\n` +
        `Staff will respond shortly.`
      );

      await interaction.reply({
        content: `✅ Ticket created: <#${ticketChannel.id}>`,
        ephemeral: true,
      });

      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
      } catch {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
