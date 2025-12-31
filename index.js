// index.js
const fs = require("fs");
const path = require("path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
require("dotenv").config();

/** ====== Your Server Config (hardcoded as requested) ====== */
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

const RESPECT_TEXT =
  "Keep in mind that our employees/boosters spend the time they should be doing other stuff in to come and help you. " +
  "Please be respectful and abide by the rules. You must pay first using a gamepass, and then we will start the boosting process. " +
  "If our employees need to leave, do not argue, as it is up to them if they want to leave. Enjoy your boosting!";

/** ====== Bot ====== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for "CLOSE TICKET"
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
    `**Step 3:** The bot will show a quote (private) and you click **Confirm Price**.\n` +
    `**Step 4:** Then click **🛒 Open Ticket**.\n\n` +
    `🧾 **Pricing:** Step-based tiered pricing starting at **100 Robux** and increases by **+10 Robux per step** up to Archnemesis.\n` +
    `🧾 The bot also shows an **estimated gamepass price** to cover Roblox fees.\n\n` +
    `⏳ After you open a ticket, staff will send the gamepass link within **1–2 minutes**.\n\n` +
    `${RESPECT_TEXT}\n\n` +
    `🔒 **To close a ticket:** Type **CLOSE TICKET** inside your ticket channel.\n` +
    `⏱️ **Ticket cooldown:** 1 ticket per minute (still applies even if you delete/close your old ticket).\n`
  );
}

function ticketTutorial(userId, fromRank, toRank, steps, net, gross) {
  const details =
    fromRank && toRank
      ? `\n\n📊 **Quote Summary**\n• From: ${fromRank}\n• To: ${toRank}\n• Steps: ${steps}\n• Net: ${net} Robux\n• Gamepass (est): ${gross} Robux`
      : "";

  return (
    `🎟️ **Ticket Created**\n\n` +
    `**Step 1:** Confirm your request here (current rank → target rank).\n` +
    `**Step 2:** Wait for staff — we will send the gamepass link within **1–2 minutes**.\n\n` +
    `${RESPECT_TEXT}\n` +
    `${details}\n\n` +
    `❌ **To close this ticket:** Type **CLOSE TICKET**\n` +
    `⏱️ **Cooldown:** 1 ticket per minute (even if you delete/close the old one).\n\n` +
    `<@${userId}>`
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
  return guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.parentId === TICKET_CATEGORY_ID &&
      typeof c.topic === "string" &&
      c.topic.includes(`ticket_owner:${userId}`)
  );
}

/** ====== Create Ticket ====== */
async function createTicket(interaction, quote) {
  const guild = interaction.guild;
  const user = interaction.user;

  if (!guild) {
    return interaction.reply({
      content: "❌ This can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // If user already has an open ticket, link them to it (no cooldown consumed)
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

  // Consume cooldown immediately (still counts even if ticket is deleted)
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

  // Filter any accidental undefined flags
  for (const ow of overwrites) {
    if (ow.allow) ow.allow = ow.allow.filter(Boolean);
    if (ow.deny) ow.deny = ow.deny.filter(Boolean);
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

  // If we have quote info from confirm button, include it in the ticket tutorial
  const fromRank = quote?.fromRank || null;
  const toRank = quote?.toRank || null;
  const steps = quote?.steps || null;
  const net = quote?.net || null;
  const gross = quote?.gross || null;

  await channel
    .send(ticketTutorial(user.id, fromRank, toRank, steps, net, gross))
    .catch(() => null);

  // Staff log
  if (isSnowflake(STAFF_LOG_CHANNEL_ID)) {
    const staffLog = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (staffLog?.isTextBased()) {
      staffLog
        .send(
          `🧾 **New Ticket** by **${user.tag}** → ${channel} | ${staffPing}` +
            (fromRank && toRank
              ? `\n📊 ${fromRank} → ${toRank} (${steps} steps)\n💰 Net: ${net} | Gamepass (est): ${gross}`
              : "")
        )
        .catch(() => null);
    }
  }

  return interaction.reply({
    content: `✅ Ticket created: ${channel}\nType **CLOSE TICKET** inside it to close it.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** ====== Handle Price Confirmation Flow ======
 * price.js sends buttons:
 *  - price_confirm:fromIndex:toIndex:net:gross:levels
 *  - price_cancel
 */
function parsePriceConfirm(customId) {
  // customId format: price_confirm:fromIndex:toIndex:net:gross:levels
  const parts = customId.split(":");
  if (parts.length !== 6) return null;

  const [, fromIndex, toIndex, net, gross, levels] = parts;

  const fi = Number(fromIndex);
  const ti = Number(toIndex);
  const n = Number(net);
  const g = Number(gross);
  const lv = Number(levels);

  if (![fi, ti, n, g, lv].every((x) => Number.isFinite(x))) return null;
  return { fromIndex: fi, toIndex: ti, net: n, gross: g, levels: lv };
}


/** ====== Rank ladder (must match price.js) ====== */
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

function fmt(n) {
  return Number(n).toLocaleString("en-US");
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

    // Buttons
    if (interaction.isButton()) {
      // Cancel the quote
      if (interaction.customId === "price_cancel") {
        // Ephemeral message edit
        await interaction.update({
          content: "❌ Cancelled.",
          components: [],
        });
        // Try to delete after a short delay
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch {}
        }, 5000);
        return;
      }

      // Confirm the quote → show Open Ticket button
      if (interaction.customId.startsWith("price_confirm:")) {
        const parsed = parsePriceConfirm(interaction.customId);
        if (!parsed) {
          await interaction.reply({
            content: "❌ Could not read the quote. Please run /price again.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const fromRank = RANKS[parsed.fromIndex] || "Unknown";
        const toRank = RANKS[parsed.toIndex] || "Unknown";

        // Replace components with Open Ticket button, and store quote in its customId
        // We'll encode minimal quote into open_ticket id for use during ticket creation.
        const openTicketId = `open_ticket:${parsed.fromIndex}:${parsed.toIndex}:${parsed.net}:${parsed.gross}:${parsed.levels}`;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("🛒 Open Ticket")
            .setStyle(ButtonStyle.Primary)
            .setCustomId(openTicketId)
        );

        await interaction.update({
          content:
            `✅ **Confirmed**\n\n` +
            `📊 ${fromRank} → ${toRank} (${parsed.levels} steps)\n` +
            `💰 Net: **${fmt(parsed.net)} Robux**\n` +
            `🧾 Gamepass (est): **${fmt(parsed.gross)} Robux**\n\n` +
            `Click **🛒 Open Ticket** to proceed.`,
          components: [row],
        });

        return;
      }

      // Open ticket button (with quote payload)
      if (interaction.customId.startsWith("open_ticket")) {
        // Accept both old "open_ticket" and new "open_ticket:..."
        let quote = null;

        const parts = interaction.customId.split(":");
        if (parts.length === 6) {
          const [, fromIndex, toIndex, net, gross, levels] = parts;
          const fi = Number(fromIndex);
          const ti = Number(toIndex);
          const n = Number(net);
          const g = Number(gross);
          const lv = Number(levels);

          if ([fi, ti, n, g, lv].every((x) => Number.isFinite(x))) {
            quote = {
              fromRank: RANKS[fi] || null,
              toRank: RANKS[ti] || null,
              steps: lv,
              net: fmt(n),
              gross: fmt(g),
            };
          }
        }

        await createTicket(interaction, quote);
        return;
      }
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
          .send(
            `🔒 **Ticket Closed** by **${message.author.tag}** in #${message.channel.name} | ${staffPing}`
          )
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

