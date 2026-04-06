/**
 * Interactive setup wizard.
 * Guides user through .env + user-config.json creation.
 * Run: npm run setup
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "user-config.json");
const ENV_PATH = path.join(__dirname, ".env");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const hint =
      defaultVal !== undefined && defaultVal !== ""
        ? ` (default: ${defaultVal})`
        : "";
    rl.question(`${question}${hint}: `, (ans) => {
      const trimmed = ans.trim();
      resolve(trimmed === "" ? defaultVal : trimmed);
    });
  });
}

function askNum(question, defaultVal, { min, max } = {}) {
  return new Promise(async (resolve) => {
    while (true) {
      const raw = await ask(question, defaultVal);
      const n = parseFloat(raw);
      if (isNaN(n)) {
        console.log(`  ⚠  Please enter a number.`);
        continue;
      }
      if (min !== undefined && n < min) {
        console.log(`  ⚠  Minimum is ${min}.`);
        continue;
      }
      if (max !== undefined && n > max) {
        console.log(`  ⚠  Maximum is ${max}.`);
        continue;
      }
      resolve(n);
      break;
    }
  });
}

function askBool(question, defaultVal) {
  return new Promise(async (resolve) => {
    while (true) {
      const hint = defaultVal ? "Y/n" : "y/N";
      const raw = await ask(`${question} [${hint}]`, "");
      if (raw === "") {
        resolve(defaultVal);
        break;
      }
      if (/^y(es)?$/i.test(raw)) {
        resolve(true);
        break;
      }
      if (/^n(o)?$/i.test(raw)) {
        resolve(false);
        break;
      }
      console.log("  ⚠  Enter y or n.");
    }
  });
}

function askChoice(question, choices) {
  return new Promise(async (resolve) => {
    const labels = choices.map((c, i) => `  ${i + 1}. ${c.label}`).join("\n");
    while (true) {
      console.log(`\n${question}`);
      console.log(labels);
      const raw = await ask("Enter number", "");
      const idx = parseInt(raw) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx]);
        break;
      }
      console.log("  ⚠  Invalid choice.");
    }
  });
}

// Timeframe with hardcoded valid-value list to prevent silent API failures
const VALID_TIMEFRAMES = ["5m", "15m", "1h", "2h", "4h", "12h", "24h"];
async function askTimeframe(defaultVal) {
  while (true) {
    const raw = await ask(
      "Pool discovery timeframe (5m / 15m / 1h / 2h / 4h / 12h / 24h)",
      defaultVal,
    );
    if (VALID_TIMEFRAMES.includes(raw)) return raw;
    console.log(
      `  ⚠  Invalid timeframe. Valid options: ${VALID_TIMEFRAMES.join(", ")}`,
    );
  }
}

function parseEnv(content) {
  const map = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return map;
}

function buildEnv(map) {
  return (
    Object.entries(map)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

// ─── Presets ──────────────────────────────────────────────────────────────────
//
// Each preset now includes ALL configurable fields so presets are self-contained.
// "30m" removed (not a valid API timeframe). Changed to "15m" for degen.
// trailingTriggerPct / trailingDropPct added — these are the primary exit mechanism.
// takeProfitFeePct is the global hard-TP fallback (per-strategy values override it).
//
const PRESETS = {
  degen: {
    label: "Degen",
    timeframe: "15m",
    minFeeActiveTvlRatio: 0.1, // 15m timeframe: ≥0.05 = decent, ≥0.10 = strong
    minOrganic: 60,
    minHolders: 200,
    minMcap: 100_000,
    maxMcap: 5_000_000,
    minTokenFeesSol: 20,
    maxBotHoldersPct: 40,
    trailingTakeProfit: true, // master switch — must stay true for trailing to activate
    trailingTriggerPct: 4, // activate trailing TP at +4% PnL
    trailingDropPct: 1.5, // close if PnL drops 1.5% from peak
    takeProfitFeePct: 10, // hard fallback TP at +10% total PnL (strategies override per-position)
    stopLossPct: -25,
    outOfRangeWaitMinutes: 15,
    managementIntervalMin: 5,
    screeningIntervalMin: 15,
    description:
      "15m timeframe, pumping tokens, fast cycles. High risk/reward.",
  },
  moderate: {
    label: "Moderate",
    timeframe: "4h",
    minFeeActiveTvlRatio: 0.8, // 4h timeframe: ≥0.8 = decent
    minOrganic: 65,
    minHolders: 500,
    minMcap: 150_000,
    maxMcap: 10_000_000,
    minTokenFeesSol: 30,
    maxBotHoldersPct: 30,
    trailingTakeProfit: true,
    trailingTriggerPct: 5,
    trailingDropPct: 2,
    takeProfitFeePct: 10,
    stopLossPct: -15,
    outOfRangeWaitMinutes: 30,
    managementIntervalMin: 10,
    screeningIntervalMin: 30,
    description:
      "4h timeframe, balanced risk/reward. Recommended for most users.",
  },
  safe: {
    label: "Safe",
    timeframe: "24h",
    minFeeActiveTvlRatio: 3.0, // 24h timeframe: ≥3.0 = decent
    minOrganic: 75,
    minHolders: 1000,
    minMcap: 500_000,
    maxMcap: 10_000_000,
    minTokenFeesSol: 40,
    maxBotHoldersPct: 20,
    trailingTakeProfit: true,
    trailingTriggerPct: 7,
    trailingDropPct: 3,
    takeProfitFeePct: 10,
    stopLossPct: -10,
    outOfRangeWaitMinutes: 60,
    managementIntervalMin: 15,
    screeningIntervalMin: 60,
    description:
      "24h timeframe, stable pools only, avoids pumps. Lower yield, lower risk.",
  },
};

// fee/TVL ratio context hints — displayed when asking for the threshold
const FEE_TVL_HINTS = {
  "5m": "≥0.02 = decent,  ≥0.05 = strong",
  "15m": "≥0.05 = decent,  ≥0.10 = strong",
  "1h": "≥0.20 = decent,  ≥0.50 = strong",
  "2h": "≥0.40 = decent,  ≥1.00 = strong",
  "4h": "≥0.80 = decent,  ≥2.00 = strong",
  "12h": "≥2.00 = decent,  ≥5.00 = strong",
  "24h": "≥3.00 = decent,  ≥8.00 = strong",
};

// ─── Load existing state ───────────────────────────────────────────────────────
const existingConfig = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  : {};
const existingEnv = fs.existsSync(ENV_PATH)
  ? parseEnv(fs.readFileSync(ENV_PATH, "utf8"))
  : {};

const e = (key, fallback) => existingConfig[key] ?? fallback;
const ev = (key, fallback) => existingEnv[key] ?? fallback;

// ─── Banner ────────────────────────────────────────────────────────────────────
console.log(`
╔═══════════════════════════════════════════════╗
║        Meridian — Setup Wizard                ║
║        Autonomous Meteora DLMM LP Agent       ║
╚═══════════════════════════════════════════════╝

This wizard creates your .env and user-config.json.
Press Enter to keep the current/default value.
`);

// ─── Section 1: API Keys & Wallet ─────────────────────────────────────────────
console.log("── API Keys & Wallet ─────────────────────────────────────────");

const alreadySet = (val) => (val ? "*** (already set — Enter to keep)" : "");

const openrouterKey = await ask(
  "OpenRouter API key (sk-or-...)",
  alreadySet(ev("OPENROUTER_API_KEY", "")),
);

const walletKey = await ask(
  "Wallet private key (base58)",
  alreadySet(ev("WALLET_PRIVATE_KEY", existingConfig.walletKey || "")),
);

const rpcUrl = await ask(
  "RPC URL",
  ev("RPC_URL", e("rpcUrl", "https://api.mainnet-beta.solana.com")),
);

const heliusKey = await ask(
  "Helius API key (for balance lookups, optional)",
  alreadySet(ev("HELIUS_API_KEY", "")),
);

// ─── Section 2: Telegram ──────────────────────────────────────────────────────
console.log("\n── Telegram (optional — skip to disable) ─────────────────────");

const telegramToken = await ask(
  "Telegram bot token",
  alreadySet(ev("TELEGRAM_BOT_TOKEN", "")),
);

const telegramChatId = await ask(
  "Telegram chat ID",
  ev("TELEGRAM_CHAT_ID", e("telegramChatId", "")),
);

// ─── Section 3: Preset ────────────────────────────────────────────────────────
const presetChoice = await askChoice("Select a risk preset:", [
  { label: `🔥 Degen    — ${PRESETS.degen.description}`, key: "degen" },
  { label: `⚖️  Moderate — ${PRESETS.moderate.description}`, key: "moderate" },
  { label: `🛡️  Safe     — ${PRESETS.safe.description}`, key: "safe" },
  { label: "⚙️  Custom   — Configure every setting manually", key: "custom" },
]);

const preset = presetChoice.key === "custom" ? null : PRESETS[presetChoice.key];
const p = (key, fallback) => preset?.[key] ?? e(key, fallback);

console.log(
  preset
    ? `\n✓ ${preset.label} preset selected. Override individual values below (Enter to keep).\n`
    : `\nCustom mode — configure all settings.\n`,
);

// ─── Section 4: Deployment ────────────────────────────────────────────────────
console.log("── Deployment ────────────────────────────────────────────────");

const deployAmountSol = await askNum(
  "SOL to deploy per position (minimum floor — actual amount scales with wallet size)",
  e("deployAmountSol", 0.3),
  { min: 0.01, max: 50 },
);

const positionSizePct = await askNum(
  "Position size as fraction of wallet (e.g. 0.35 = 35% of wallet per deploy).\n  The actual deploy = max(deployAmountSol, wallet × positionSizePct), capped by maxDeployAmount",
  e("positionSizePct", 0.35),
  { min: 0.05, max: 1.0 },
);

const maxDeployAmount = await askNum(
  "Max SOL to deploy in a single position (capital risk cap)",
  e("maxDeployAmount", 5),
  { min: 0.1 },
);

const maxPositions = await askNum(
  "Max concurrent open positions",
  e("maxPositions", 3),
  { min: 1, max: 10 },
);

const gasReserve = await askNum(
  "SOL to keep reserved for gas/transaction fees (never deployed)",
  e("gasReserve", 0.2),
  { min: 0.05 },
);

const minSolToOpen = await askNum(
  "Min SOL balance required to open a new position",
  e("minSolToOpen", parseFloat((deployAmountSol + gasReserve).toFixed(3))),
  { min: 0.05 },
);

const dryRun = await askBool(
  "Dry run mode? (no real transactions)",
  e("dryRun", true),
);

// ─── Section 5: Risk & Filters ────────────────────────────────────────────────
console.log("\n── Risk & Filters ────────────────────────────────────────────");
console.log("  Note: fee/TVL ratio thresholds depend heavily on timeframe.");
console.log("  The same pool shows much larger ratios on 24h than on 5m.\n");

// Fixed: "30m" removed (not a valid API timeframe). Free text with validation.
const timeframe = await askTimeframe(p("timeframe", "4h"));

// Show timeframe-appropriate guidance for the fee/TVL threshold
const feeHint = FEE_TVL_HINTS[timeframe] || "pool-specific";
const minFeeActiveTvlRatio = await askNum(
  `Min fee/active-TVL ratio — key pool quality filter\n  For ${timeframe} timeframe: ${feeHint}`,
  p(
    "minFeeActiveTvlRatio",
    e("minFeeActiveTvlRatio", preset?.minFeeActiveTvlRatio ?? 0.05),
  ),
  { min: 0, max: 1000 },
);

const minOrganic = await askNum(
  "Min organic score (0–100, filters out fake volume / bot-pumped tokens)",
  p("minOrganic", 65),
  { min: 0, max: 100 },
);

const minHolders = await askNum("Min token holders", p("minHolders", 500), {
  min: 1,
});

const minMcap = await askNum(
  "Min token market cap USD",
  p("minMcap", e("minMcap", 150_000)),
  { min: 0 },
);

const maxMcap = await askNum(
  "Max token market cap USD",
  p("maxMcap", 10_000_000),
  { min: 100_000 },
);

const minTokenFeesSol = await askNum(
  "Min global fees paid in SOL — tokens below this are likely bundled/scam (default: 30)",
  p("minTokenFeesSol", e("minTokenFeesSol", 30)),
  { min: 0 },
);

const maxBotHoldersPct = await askNum(
  "Max bot holder addresses % — drops tokens with excessive bot wallets (default: 30)",
  p("maxBotHoldersPct", e("maxBotHoldersPct", 30)),
  { min: 0, max: 100 },
);

// ─── Section 6: Exit Rules ────────────────────────────────────────────────────
console.log("\n── Exit Rules ────────────────────────────────────────────────");
console.log("  Active strategies override these per-position. These are the");
console.log("  global fallback for positions without strategy metadata.\n");

const trailingTriggerPct = await askNum(
  "Trailing take-profit: activate when position PnL reaches +X%",
  p("trailingTriggerPct", e("trailingTriggerPct", 5)),
  { min: 0.5, max: 100 },
);

const trailingDropPct = await askNum(
  "Trailing take-profit: close when PnL drops X% from its peak (trailing stop)",
  p("trailingDropPct", e("trailingDropPct", 2)),
  { min: 0.1, max: 50 },
);

const takeProfitFeePct = await askNum(
  "Hard take-profit: close when total position PnL reaches +X% (set high to rely on trailing TP above)",
  p("takeProfitFeePct", 10),
  { min: 0.1, max: 100 },
);

const stopLossPct = await askNum(
  "Stop loss: close when total position PnL drops to X% (e.g. -15 = close when down 15%)",
  p("stopLossPct", -15),
  { min: -99, max: -1 },
);

const outOfRangeWaitMinutes = await askNum(
  "Minutes out-of-range before closing (global default — strategies override per-position)",
  p("outOfRangeWaitMinutes", 30),
  { min: 1 },
);

// ─── Section 7: Scheduling ────────────────────────────────────────────────────
console.log("\n── Scheduling ────────────────────────────────────────────────");

const managementIntervalMin = await askNum(
  "Management cycle interval (minutes)",
  p("managementIntervalMin", 10),
  { min: 1 },
);

const screeningIntervalMin = await askNum(
  "Screening cycle interval (minutes)",
  p("screeningIntervalMin", 30),
  { min: 5 },
);

// ─── Section 8: LLM Provider ─────────────────────────────────────────────────
console.log("\n── LLM Provider ──────────────────────────────────────────────");

const LLM_PROVIDERS = [
  {
    label: "OpenRouter   (openrouter.ai — many models)",
    key: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-...",
    modelDefault: "nousresearch/hermes-3-llama-3.1-405b",
  },
  {
    label: "MiniMax      (api.minimax.io)",
    key: "minimax",
    baseUrl: "https://api.minimax.io/v1",
    keyHint: "your MiniMax API key",
    modelDefault: "MiniMax-Text-01",
  },
  {
    label: "OpenAI       (api.openai.com)",
    key: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "sk-...",
    modelDefault: "gpt-4o",
  },
  {
    label: "Local / LM Studio / Ollama (OpenAI-compatible)",
    key: "local",
    baseUrl: "http://localhost:1234/v1",
    keyHint: "(leave blank or type any value)",
    modelDefault: "local-model",
  },
  {
    label: "Custom       (any OpenAI-compatible endpoint)",
    key: "custom",
    baseUrl: "",
    keyHint: "your API key",
    modelDefault: "",
  },
];

const providerChoice = await askChoice(
  "Select LLM provider:",
  LLM_PROVIDERS.map((pr) => ({ label: pr.label, key: pr.key })),
);
const provider = LLM_PROVIDERS.find((pr) => pr.key === providerChoice.key);

let llmBaseUrl = provider.baseUrl;
if (provider.key === "local" || provider.key === "custom") {
  llmBaseUrl = await ask(
    "Base URL",
    e("llmBaseUrl", provider.baseUrl || "http://localhost:1234/v1"),
  );
}

const llmApiKeyExisting = e(
  "llmApiKey",
  existingEnv.LLM_API_KEY || existingEnv.OPENROUTER_API_KEY || "",
);
const llmApiKeyRaw = await ask(
  "API Key",
  llmApiKeyExisting ? "*** (already set)" : provider.keyHint || "",
);
const llmApiKey = llmApiKeyRaw.startsWith("***")
  ? llmApiKeyExisting
  : llmApiKeyRaw;

const llmModel = await ask(
  "Model name",
  e("llmModel", process.env.LLM_MODEL || provider.modelDefault),
);

rl.close();

// ─── Write .env ───────────────────────────────────────────────────────────────
const isKept = (val) => !val || val.startsWith("***");

const envMap = {
  ...existingEnv,
  ...(isKept(openrouterKey) ? {} : { OPENROUTER_API_KEY: openrouterKey }),
  ...(isKept(walletKey) ? {} : { WALLET_PRIVATE_KEY: walletKey }),
  ...(rpcUrl ? { RPC_URL: rpcUrl } : {}),
  ...(isKept(heliusKey) ? {} : { HELIUS_API_KEY: heliusKey }),
  ...(isKept(telegramToken) ? {} : { TELEGRAM_BOT_TOKEN: telegramToken }),
  ...(telegramChatId ? { TELEGRAM_CHAT_ID: telegramChatId } : {}),
  DRY_RUN: dryRun ? "true" : "false",
};
fs.writeFileSync(ENV_PATH, buildEnv(envMap));

// ─── Write user-config.json ───────────────────────────────────────────────────
const userConfig = {
  ...existingConfig,

  // ── Metadata (used by setup.js re-runs, not read by the bot itself) ──
  preset: presetChoice.key,
  llmProvider: provider.key,

  // ── Infrastructure ────────────────────────────────────────────────────
  rpcUrl,
  dryRun,

  // ── LLM ──────────────────────────────────────────────────────────────
  llmBaseUrl,
  llmModel,
  ...(llmApiKey ? { llmApiKey } : {}),

  // ── Telegram ─────────────────────────────────────────────────────────
  // Written here as a fallback; primary source is TELEGRAM_CHAT_ID in .env
  telegramChatId: telegramChatId || "",

  // ── Deployment ───────────────────────────────────────────────────────
  deployAmountSol,
  positionSizePct,
  maxDeployAmount,
  maxPositions,
  gasReserve,
  minSolToOpen,

  // ── Screening ────────────────────────────────────────────────────────
  timeframe,
  minFeeActiveTvlRatio,
  minOrganic,
  minHolders,
  minMcap,
  maxMcap,
  minTokenFeesSol,
  maxBotHoldersPct,

  // ── Exit Rules ───────────────────────────────────────────────────────
  trailingTakeProfit: true, // pinned — must never silently flip off; strategies rely on this
  trailingTriggerPct,
  trailingDropPct,
  takeProfitFeePct,
  stopLossPct,
  outOfRangeWaitMinutes,

  // ── Scheduling ───────────────────────────────────────────────────────
  managementIntervalMin,
  screeningIntervalMin,
};

// Remove legacy keys if present
delete userConfig.emergencyPriceDropPct;

fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));

// ─── Summary ──────────────────────────────────────────────────────────────────
const presetName = preset ? preset.label : "Custom";

console.log(`
╔═══════════════════════════════════════════════╗
║           Setup Complete                      ║
╚═══════════════════════════════════════════════╝

  Preset:       ${presetName}
  Dry run:      ${dryRun ? "YES — no real transactions" : "NO — live trading"}

  Deploy:       ${deployAmountSol} SOL floor  ·  ${(positionSizePct * 100).toFixed(0)}% of wallet  ·  max ${maxDeployAmount} SOL/position
  Positions:    max ${maxPositions} open  ·  gas reserve ${gasReserve} SOL  ·  open when ≥ ${minSolToOpen} SOL

  Timeframe:    ${timeframe}  ·  fee/TVL ≥ ${minFeeActiveTvlRatio}  ·  organic ≥ ${minOrganic}  ·  holders ≥ ${minHolders}
  Market cap:   $${minMcap.toLocaleString()} – $${maxMcap.toLocaleString()}
  Safety:       fees ≥ ${minTokenFeesSol} SOL  ·  bots ≤ ${maxBotHoldersPct}%

  Trailing TP:  activates at +${trailingTriggerPct}% PnL  ·  closes on ${trailingDropPct}% pullback from peak
  Hard TP:      +${takeProfitFeePct}% total PnL  (fallback when no active strategy)
  Stop loss:    ${stopLossPct}% total PnL
  OOR close:    after ${outOfRangeWaitMinutes} min  (strategies override per-position)

  Cycles:       management every ${managementIntervalMin}m  ·  screening every ${screeningIntervalMin}m
  Provider:     ${provider.label.split("(")[0].trim()}
  Model:        ${llmModel}
  Base URL:     ${llmBaseUrl}
  Telegram:     ${telegramToken ? "enabled" : "disabled"}

  .env:         ${ENV_PATH}
  Config:       ${CONFIG_PATH}

Run "npm start" to launch the agent.
${dryRun ? "\n  ⚠  DRY RUN is ON — set dryRun: false in user-config.json when ready for live trading.\n" : ""}
`);
