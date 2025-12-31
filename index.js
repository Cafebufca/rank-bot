const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  MessageFlags,
} = require("discord.js");
require("dotenv").config();

/** ====== Your Server Config ====== */
const SERVER_NAME = "Summit Account Boosting";

const COMMAND_CHANNEL_ID = "1455724333333745796";
const TICKET_CATEGORY_ID = "1455736127955931272";
const STAFF_LOG_CHANNEL_ID = "1455724718970634261";
const STAFF_ROLE_ID = "1454948532879491153";

/** ====== Ticket Cooldown (persists even if ticket is deleted) ====== */
const TICKET_COOLDOWN_MS = 60_000;
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
const ticketCooldowns = loadCooldowns(); // { userId: timestampMs }

function isSnowflake(id) {
  return typeof id === "string" && /^[0-9]{15,21}$/.test(id.trim());
}

/** ====== Bot ====== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // required for "CLOSE TICKET"
  ],
});

client.commands = new Collection();

/** ====== Load Slash Commands ====== */
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.existsSync(commandsPath)
  ? fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"))
  : [];

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data?.name || typeof command.execute !== "function") {
    console.log(`⚠️ Skipping invalid command file: ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

/** ====== Tutorial Text ====== */
function commandChannelTutorial() {
  return (
    `📘 **Welcome to ${SERVER_NAME} — How to use this channel**\n\n` +
    `**Step 1:** Type **/price** in this channel.\n` +
    `**Step 2:** Pick your current rank and the rank you want from the dropdowns.\n` +
    `**Step 3:** Pricing is **50 Robux per level** — the bot will calculate the total (private).\n` +
    `**Step 4:** Click **🛒 Open Ticket** to create a ticket.\n\n` +
    `⏳ After you open a ticket, staff will send the gamepass link within **1–2 minutes**.\n\n` +
    `🔒 **To close a ticket:** Type **CLOSE TICKET** inside your ticket channel.\n` +
    `⏱️ **Ticket cooldown:** 1 ticket per minute (still applies even if you delete/close your old ticket).\n`
  );
}

function ticketTutorial(fromWhereText) {
  return (
    `🎟️ **Ticket Created**\n\n` +
    `**Step 1:** Confirm your request here (current rank → target rank).\n` +
    `**Step 2:** Wait for staff — we will send the gamepass link within **1–2 minutes**.\n\n` +
    `🧾 **Pricing rule:** 50 Robux per level.\n` +
    `🧠 Tip: Use **/price** in <#${COMMAND_CHANNEL_ID}> if you need to re-check the total.\n\n` +
    `❌ **To close this ticket:** Type **CLOSE TICKET**\n` +
    `⏱️ **Cooldown:** 1 ticket per minute.\n\n` +
    `${fromWhereText || ""}`
  );
}

/** ====== Post tutorial in command channel (once-ish) ====== */
async function postCommandTutorialOnce() {
  const ch = await client.channels.fetch(COMMAND_CHANNEL_ID).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msgs = await ch.messages.fetch({ limit: 10 }).catch(() => null);
  const already = msgs?.some(
    (m) => m.author.id === client.user.id && m.content.includes("How to use this channel")
  );
  if (already) return;

  await ch.send(commandChannelTutorial()).catch(() => null);
}

/** ====== Find existing open ticket for user ====== */
function findExistingTicketChannel(guild, userId) {
  // We store userId in channel topic. This is reliable and fast.
  return guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.parentId === TICKET_CATEGORY_ID &&
      typeof c.topic === "string" &&
      c.topic.includes(`ticket_owner:${userId}`)
  );
}

/** ====== Create Ticket ====== */
async function createTicket(interaction) {
  const guild = interaction.guild;
  const user = interaction.user;

  if (!guild) {
    return interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // If user already has an open ticket, send them to it (no cooldown consumed)
  const existing = findExistingTicketChannel(guild, user.id);
  if (existing) {
    return interaction.reply({
      content: `⚠️ You already have an open ticket: ${existing}\nType **CLOSE TICKET** in it to close it.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Cooldown check (persists even if ticket is deleted)
  const last = ticketCooldowns[user.id] || 0;
  const now = Date.now();
  const remaining = TICKET_COOLDOWN_MS - (now - last);

  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    return interaction.reply({
      content: `⏱️ Please wait **${seconds}s** before opening another ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!isSnowflake(TICKET_CATEGORY_ID)) {
    return interaction.reply({
      content: "❌ Missing or invalid ticket category ID.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Consume cooldown immediately (even if they delete the channel later)
  ticketCooldowns[user.id] = now;
  saveCooldowns(ticketCooldowns);

  const safeName = `ticket-${user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90);

  const overwrites = [
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
{
  id: client.user.id,
  allow: [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageChannels,
  ],
},

  ];

  // Staff role access + ping
  if (isSnowflake(STAFF_ROLE_ID)) {
    overwrites.push({
      id: STAFF_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: safeName || `ticket-${user.id}`,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    topic: `ticket_owner:${user.id}`,
    permissionOverwrites: overwrites,
  });

  const staffPing = isSnowflake(STAFF_ROLE_ID) ? `<@&${STAFF_ROLE_ID}>` : "@staff";
  await channel.send(`${staffPing} 🛒 **New ticket opened by** <@${user.id}>`).catch(() => null);
  await channel.send(ticketTutorial(`Opened from: <#${interaction.channelId}>`)).catch(() => null);

  // Staff log
  if (isSnowflake(STAFF_LOG_CHANNEL_ID)) {
    const staffLog = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (staffLog?.isTextBased()) {
      staffLog
        .send(`🧾 **New Ticket** by **${user.tag}** → ${channel} | ${staffPing}`)
        .catch(() => null);
    }
  }

  return interaction.reply({
    content: `✅ Ticket created: ${channel}\nType **CLOSE TICKET** inside it to close it.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** ====== Events ====== */
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
        interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
      } else {
        interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
  }
});

// Close ticket by text
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (message.content.trim().toUpperCase() !== "CLOSE TICKET") return;

    // Only close channels that are tickets in the ticket category
    if (
      message.channel.type !== ChannelType.GuildText ||
      message.channel.parentId !== TICKET_CATEGORY_ID ||
      !message.channel.topic?.includes("ticket_owner:")
    ) {
      return;
    }

    const staffPing = isSnowflake(STAFF_ROLE_ID) ? `<@&${STAFF_ROLE_ID}>` : "@staff";

    await message.channel.send("✅ Closing ticket...").catch(() => null);

    // Staff log
    if (isSnowflake(STAFF_LOG_CHANNEL_ID)) {
      const staffLog = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
      if (staffLog?.isTextBased()) {
        staffLog
          .send(`🔒 **Ticket Closed** by **${message.author.tag}** in #${message.channel.name} | ${staffPing}`)
          .catch(() => null);
      }
    }

    setTimeout(() => {
      message.channel.delete().catch(() => null);
    }, 2000);
  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.DISCORD_TOKEN);

