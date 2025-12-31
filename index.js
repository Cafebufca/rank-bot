const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
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
          content: "❌ I couldn’t find your price quote. Please run `/price` again, then click Open Ticket.",
          ephemeral: true,
        });
      }

      // Prevent duplicate tickets for same user
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

      const safeUser = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 20);

      const channelName = `ticket-${safeUser}`;

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

      // Create channel (this requires Manage Channels permission)
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
        `📈 Rank Up: **${quote.fromRank} → ${quote.toRank}** (**${quote.levels} levels**)\n` +
        `💰 Amount Due: **${quote.price} Robux**\n\n` +
        `✅ **Next Step**\n` +
        `Please reply with your **Roblox username** in this ticket.\n\n` +
        `✅ **Payment Instructions**\n` +
        `1) Purchase the gamepass for **${quote.price} Robux**\n` +
        `2) Buy it from the Roblox account: **${ROBLOX_SELLER_USERNAME}**\n` +
        `3) After purchase, send proof here (screenshot / transaction info).\n\n` +
        `Staff will respond shortly.`
      );

      return interaction.reply({
        content: `✅ Ticket created: <#${ticketChannel.id}>`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);

    // Avoid "already replied" errors
    if (interaction.isRepliable()) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "❌ Something went wrong.", ephemeral: true });
        } else {
          await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
        }
      } catch {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
