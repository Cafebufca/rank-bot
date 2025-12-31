const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed to read "CLOSE TICKET"
  ],
});

client.commands = new Collection();

// ===== Load slash commands =====
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data?.name || typeof command.execute !== "function") {
    console.log(`⚠️ Skipping invalid command file: ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// ===== Ticket cooldown persistence =====
const COOLDOWN_FILE = path.join(__dirname, "ticket_cooldowns.json");
function loadCooldowns() {
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveCooldowns(obj) {
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(obj, null, 2));
}

const ticketCooldowns = loadCooldowns(); // { "userId": timestampMs }
const TICKET_COOLDOWN_MS = 60_000;

// ===== Config from .env =====
const COMMAND_CHANNEL_ID = process.env.COMMAND_CHANNEL_ID; // the channel where you want the tutorial posted
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID; // staff log channel
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // category to create tickets in
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // staff role that can see tickets
const GAMEPASS_LINK = process.env.GAMEPASS_LINK; // your gamepass link (string)

// ===== Tutorial texts =====
function commandChannelTutorial() {
  return (
    `📘 **How to use this server**\n\n` +
    `**Step 1:** Go to this channel and run **/price**\n` +
    `**Step 2:** Choose your current rank and your target rank from the dropdowns\n` +
    `**Step 3:** The bot will calculate the cost (**50 Robux per level**) and show you the total privately\n` +
    `**Step 4:** Click **🛒 Open Ticket** to create a ticket\n\n` +
    `✅ After you open a ticket, we’ll send the gamepass link within **1–2 minutes** (please be patient).\n` +
    `🧾 **Pricing rule:** 50 Robux per level (Bronze → Silver → Gold → Platinum → Diamond → Onyx → Nemesis → Archnemesis)\n\n` +
    `🔒 **Closing tickets:** Type **CLOSE TICKET** in your ticket channel to close it.\n`
  );
}

function ticketTutorial(userId) {
  return (
    `🎟️ **Ticket Created**\n\n` +
    `**Step 1:** Confirm your request here (current rank → target rank).\n` +
    `**Step 2:** Wait for staff — the gamepass link will be sent within **1–2 minutes**.\n\n` +
    `🔗 **Gamepass link:** ${GAMEPASS_LINK || "(staff will send)"}\n\n` +
    `🧾 **Important:** To close this ticket, type **CLOSE TICKET**.\n` +
    `⏱️ **Cooldown:** You can open **one ticket per minute**. Even if you close/delete your old ticket, the cooldown still applies.\n` +
    `<@${userId}>`
  );
}

// ===== Post tutorial in command channel on startup =====
async function postCommandTutorialOnce() {
  if (!COMMAND_CHANNEL_ID) return;

  const ch = await client.channels.fetch(COMMAND_CHANNEL_ID).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  // Optional: Only post if last message isn't already the tutorial (simple check)
  const msgs = await ch.messages.fetch({ limit: 5 }).catch(() => null);
  const already = msgs?.some((m) => m.author.id === client.user.id && m.content.includes("How to use this server"));
  if (already) return;

  await ch.send(commandChannelTutorial()).catch(() => null);
}

// ===== Create ticket helper =====
async function createTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;

  // Cooldown check (persists even if channels are deleted)
  const last = ticketCooldowns[user.id] || 0;
  const now = Date.now();
  const remaining = TICKET_COOLDOWN_MS - (now - last);

  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    return interaction.reply({
      content: `⏱️ Please wait **${seconds}s** before opening another ticket.`,
      ephemeral: true,
    });
  }

  if (!TICKET_CATEGORY_ID) {
    return interaction.reply({
      content: "❌ Ticket system is not configured (missing TICKET_CATEGORY_ID).",
      ephemeral: true,
    });
  }

  // Record cooldown immediately so it still counts even if channel is deleted
  ticketCooldowns[user.id] = now;
  saveCooldowns(ticketCooldowns);

  // Create channel
  const safeName = `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const channel = await guild.channels.create({
    name: safeName.slice(0, 90),
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      ...(STAFF_ROLE_ID
        ? [
            {
              id: STAFF_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
              ],
            },
          ]
        : []),
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManagePermissions,
        ],
      },
    ],
  });

  // Send tutorial in the ticket
  await channel.send(ticketTutorial(user.id));

  // Staff log
  if (STAFF_LOG_CHANNEL_ID) {
    const staffLog = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (staffLog?.isTextBased()) {
      staffLog.send(`🛒 Ticket opened by **${user.tag}** → ${channel}`).catch(() => null);
    }
  }

  // Confirm to user
  return interaction.reply({
    content: `✅ Ticket created: ${channel}\nType **CLOSE TICKET** inside it when you’re done.`,
    ephemeral: true,
  });
}

// ===== Events =====
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await postCommandTutorialOnce();
});

client.on("interactionCreate", async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
      return;
    }

    // Ticket button
    if (interaction.isButton() && interaction.customId === "open_ticket") {
      await createTicket(interaction);
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = "❌ Something went wrong. Please try again.";
      if (interaction.deferred || interaction.replied) {
        interaction.followUp({ content: msg, ephemeral: true }).catch(() => null);
      } else {
        interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
      }
    }
  }
});

// Close ticket by text
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.content.trim().toUpperCase() !== "CLOSE TICKET") return;

  // Only close channels that look like tickets
  if (!message.channel.name.startsWith("ticket-")) return;

  // Optional: allow only ticket owner or staff
  const isStaff = STAFF_ROLE_ID ? message.member.roles.cache.has(STAFF_ROLE_ID) : false;
  const isOwnerMentioned = message.channel.topic && message.channel.topic.includes(message.author.id); // (not used here)
  // Simple rule: allow anyone in the ticket to close it
  // If you want only owner/staff, tell me and I’ll lock it down.

  await message.channel.send("✅ Closing ticket...").catch(() => null);

  // Staff log
  if (STAFF_LOG_CHANNEL_ID) {
    const staffLog = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (staffLog?.isTextBased()) {
      staffLog.send(`🔒 Ticket closed by **${message.author.tag}** in #${message.channel.name}`).catch(() => null);
    }
  }

  // Delete after a short delay
  setTimeout(() => {
    message.channel.delete().catch(() => null);
  }, 2000);
});

client.login(process.env.DISCORD_TOKEN);
