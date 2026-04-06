/**
 * Strategy Library — persistent store of LP strategies.
 *
 * Users paste a tweet or description via Telegram.
 * The agent extracts structured criteria and saves it here.
 * During screening, the active strategy's criteria guide token selection and position config.
 *
 * Improvements over v1:
 *  - Version-aware defaults: built-in strategies auto-update when code changes
 *  - spot_wide strategy: safest default for automated bots
 *  - Performance tracking: wins/losses/avg PnL recorded per strategy
 *  - recommendStrategy(): picks best fit from pool characteristics
 *  - Built-in protection: meridian-authored strategies cannot be deleted
 *  - getStrategyPromptBlock(): richer screener prompt string
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGY_FILE = path.join(__dirname, "strategy-library.json");

// Bump this whenever DEFAULT_STRATEGIES content changes — triggers auto-update of built-ins
const BUILTIN_VERSION = 6;

// ─── Persistence ────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(STRATEGY_FILE))
    return { active: null, strategies: {}, builtin_version: 0 };
  try {
    return JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
  } catch {
    return { active: null, strategies: {}, builtin_version: 0 };
  }
}

function save(data) {
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2));
}

// ─── Default Strategies ─────────────────────────────────────────

const DEFAULT_STRATEGIES = {
  classic_overnight_bid_ask: {
    id: "classic_overnight_bid_ask",
    name: "Classic / Overnight Bid-Ask",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "medium",
    token_criteria: {
      min_mcap: 500_000,
      max_mcap: 2_000_000,
      min_age_hours: 48,
      min_volume_5m: 100_000,
      notes:
        "Post-dip runners (-20–40% from local ATH). mcap 500k–2M+, age >2 days, organic volume (GMGN/Jupiter 5-min >100k steady). Strong narrative/KOL interest, clean chart/holders. Dynamic-fee pool with decent (not oversized) TVL. Do NOT chase — wait for confirmed dip/pain and structure.",
    },
    entry: {
      condition:
        "Enter after confirmed dip with structure showing rebound bias",
      single_side: "sol",
      notes:
        "Single-sided SOL only (amount_y, amount_x=0). Directional rebound bias. Wait for -20–40% dip from local ATH before deploying. Do not enter while price is still falling — wait for structure confirmation.",
    },
    range: {
      type: "wide",
      bins_below: 50,
      bins_above: 0,
      total_bins: 50,
      notes:
        "Wide ~45–80+ bins total. Cover -40% to -50% below entry price. bins_above=0 (SOL-only, no token side). Minimal or zero bins above — all range is below for DCA-in on further dips.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 7,
      trailing_drop_pct: 2,
      oor_timeout_minutes: 30,
      notes:
        "Trailing TP: activates at 7% PnL, closes on 2% drop from peak. Hard TP removed — trailing always fires first and gives better exits on volatile tokens. Close early on no-recovery signal (volume dying, narrative breaking). OOR handling: reposition or cut if narrative breaks. No auto re-seed. Hold overnight/multi-hour — designed for sleep plays.",
    },
    best_for:
      "Overnight/multi-hour holds while you sleep or work. Fee accumulation + directional recovery on dipped runners. Great for beginners building edge.",
  },

  retrace_bid_ask_flip: {
    id: "retrace_bid_ask_flip",
    name: "Retrace Bid-Ask Flip",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "medium",
    token_criteria: {
      min_volume_5m: 200_000,
      min_tvl: 100_000,
      max_tvl: 150_000,
      notes:
        "Strong runner back toward ATH after a nice dip. Volume 200–500k+/5min on GMGN. Dynamic fee > base fee (ideally spiking). TVL 100–150k. Solid news/narrative driving the move. R/R approximately 6:9.",
    },
    entry: {
      condition:
        "New ATH candle or strong retrace — price corrects then expected to pump back",
      single_side: "sol",
      notes:
        "Phase 1: Single-sided SOL only on tight bid-ask below ATH. Deploy on new ATH candle or when strong retrace confirmed. Phase 2: Once SOL is mostly converted to tokens (position goes OOR downward), WITHDRAW (do not close) and flip to single-sided token bid-ask at same range. Fast hands required.",
    },
    range: {
      type: "tight",
      bins_below: 15,
      bins_above: 0,
      total_bins: 15,
      notes:
        "Tight -20% to -25% from ATH, typically 10–20 bins depending on volatility. bins_above=0 for SOL-only phase. Phase 2 flip uses same range with token-only.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 10,
      trailing_drop_pct: 3,
      oor_timeout_minutes: 5,
      notes:
        "Phase 1: withdraw (NOT close) once SOL is mostly converted to tokens. Phase 2: flip to single-sided token bid-ask at same range. TP 15%+ from dip or when price returns to ATH/lower high. Exit on OOR if still bullish with conviction. Re-seed only on same token if momentum continues. High-frequency compounding via multiple cycles.",
    },
    best_for:
      "Active momentum runners with clear retrace → pump pattern. Beats pure spot via fees + IL profit. High frequency compounding.",
    phase2: {
      single_side: "token",
      bins_below: 0,
      bins_above: 15,
      oor_timeout_minutes: 15,
      trailing_trigger_pct: 10,
      trailing_drop_pct: 3,
      notes:
        "Token-only flip: deploy tokens in bins ABOVE active bin (range for recovery). Same pool. Wait for price to pump back through range.",
    },
  },

  tight_bid_ask_quick_flips: {
    id: "tight_bid_ask_quick_flips",
    name: "Tight Bid-Ask Quick Flips",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "high",
    token_criteria: {
      min_volume_5m: 100_000,
      notes:
        "High-volume live runners (100k–400k+/5min). Good narrative. Post-dump retrace or bounce structure visible on chart. Dynamic-fee pools only — need volatility to earn. Active monitoring required at all times.",
    },
    entry: {
      condition:
        "On volatility/dump into range — short-term bounce bias confirmed",
      single_side: "sol",
      notes:
        "Single-sided SOL only (amount_y, amount_x=0). Enter on volatility spike or dump into your range. Directional short-term bounce bias. 5–20 minute hold target. Multiple positions per session on same token are normal.",
    },
    range: {
      type: "tight",
      bins_below: 10,
      bins_above: 0,
      total_bins: 10,
      notes:
        "Very tight -7% to -15% below entry, ~10 bins max. bins_above=0. Tight range maximises fee density and conversion speed on small bounces.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 4,
      trailing_drop_pct: 1.5,
      oor_timeout_minutes: 5,
      notes:
        "TP when price rebounds and position starts going OOR upward (often 5–20 min holds). Quick close + re-seed same token if still pumping. Cut FAST on dead volume — do not hold dead positions. Multiple re-seeds per session on same token if momentum holds.",
    },
    best_for:
      "Hyper-active degen flips on hot new/high-volume tokens. Capture initial volatility + fees before TVL thickens. Multiple positions per session.",
  },

  tight_wide_token_recovery: {
    id: "tight_wide_token_recovery",
    name: "Tight → Wide Token-Side Recovery",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "medium",
    token_criteria: {
      notes:
        "Strong runner with genuine narrative that has already dumped ~40% from ATH. Huge volume still present. TVL not yet crowded. High conviction that token will recover. Example: anime-sol 43% gain case.",
    },
    entry: {
      condition:
        "Phase 1 tight SOL bid-ask on dump; Phase 2 wide token-only after conversion",
      single_side: "sol",
      notes:
        "Phase 1: Deploy single-sided SOL on tight bid-ask (-7% to -15%) as price dumps. Wait for full SOL→token conversion. Phase 2: Close Phase 1 after conversion. Re-deploy token-only bid-ask with wide UPSIDE range (100–300% above entry) for recovery play. Strong directional recovery bias required for Phase 2.",
    },
    range: {
      type: "tight",
      bins_below: 10,
      bins_above: 0,
      total_bins: 10,
      notes:
        "Phase 1: tight bins_below=10, bins_above=0 (SOL-only, -7% to -15%). Phase 2 (token-only recovery): bins_below=0, bins_above=69 (wide upside 100–300%). Set Phase 2 range wide enough to capture full recovery sweep.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 15,
      trailing_drop_pct: 5,
      oor_timeout_minutes: 10,
      notes:
        "Phase 1: close after full SOL→token conversion (not withdraw — full close before Phase 2 deploy). Phase 2: hold for recovery sweep + fees. TP on strong bounce or narrative confirmation. OOR upward in Phase 2 = profit — close and take it. Reposition wider if conviction still high on OOR downside. No re-seed if conviction gone.",
    },
    best_for:
      "High-conviction narrative tokens expecting bounce after ~40% dump. Efficient accumulation on way down + DCA recovery on way up. Avoids crowded wide SOL ranges.",
    phase2: {
      single_side: "token",
      bins_below: 0,
      bins_above: 69,
      oor_timeout_minutes: 30,
      trailing_trigger_pct: 15,
      trailing_drop_pct: 5,
      notes:
        "Wide token-only upside recovery: deploy all recovered tokens in bins_above=69 for 100-300% recovery range. Same pool.",
    },
  },

  afk_passive_bid_ask: {
    id: "afk_passive_bid_ask",
    name: "AFK / Passive Bid-Ask",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "low",
    token_criteria: {
      min_volume_5m: 30_000,
      min_tvl: 60_000,
      max_tvl: 150_000,
      notes:
        "Steady price action at or near ATH. Minimum 30–50k vol/5min with spikes to 80–100k+. TVL 60–150k. Potential narrative but no immediate price chase needed. Use VPVR to identify fair-price/high-volume zone for range placement. Beginner-friendly.",
    },
    entry: {
      condition:
        "Token at ATH but you don't want to chase — use VPVR fair-value zone",
      single_side: "sol",
      notes:
        "Single-sided SOL only (amount_y, amount_x=0). Enter after token hits ATH but do NOT chase the top. Use VPVR (volume profile visible range) to identify the highest-volume price bar as your range center. Capital-efficient — not full wide, concentrated around fair value.",
    },
    range: {
      type: "vpvr_concentrated",
      bins_below: 20,
      bins_above: 0,
      total_bins: 20,
      notes:
        "Concentrated around VPVR high-volume bar. Max price = current price - some %, min price = last visible VPVR support bar. ~20 bins (not full wide). bins_above=0. If price never dumps into range, position earns nothing but loses nothing — maximum capital efficiency.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 6,
      trailing_drop_pct: 2,
      oor_timeout_minutes: 180,
      notes:
        "Trailing TP: activates at 6% PnL, closes on 2% drop from peak. Hard TP removed — trailing always fires first and gives better exits on set-and-forget holds. OOR handling: leave it — if it never touches your range you lose nothing (max efficiency). Re-seed only on a fresh new setup with updated VPVR analysis.",
    },
    best_for:
      "Sleep/go-away plays, off-chart passive fee farming. Perfect for busy people or lower time commitment. Near-zero downside if range never hit.",
  },

  token_sided_deep_dump: {
    id: "token_sided_deep_dump",
    name: "Token-Sided on Deep Dumps",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "high",
    token_criteria: {
      notes:
        "Deep bleed — 60–80%+ from ATH — but strong ongoing narrative and conviction. Volume still present (not dead). You must already hold or be willing to buy the token. Only deploy when you have a genuine edge on long-term rebound. Do NOT use on rugs or dead narratives.",
    },
    entry: {
      condition:
        "Buy token first, then deploy token-sided — strong directional recovery bias",
      single_side: "token",
      notes:
        "Token-only deploy (amount_x only, amount_y=0). Buy your token position first, then deploy it into a wide upside bid-ask. All tokens placed in bins ABOVE current price — as price recovers upward through bins, tokens sell for SOL. Directional long bias required. High conviction plays only.",
    },
    range: {
      type: "wide_upside",
      bins_below: 0,
      bins_above: 69,
      total_bins: 69,
      notes:
        "Wide upside — bins_below=0, bins_above=69 (100%+ recovery range). All bins above current price. Tokens gradually sell as price pumps through each bin, capturing fees and locking in SOL on the way up.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 20,
      trailing_drop_pct: 5,
      oor_timeout_minutes: 15,
      notes:
        "Hold until recovery pump or narrative fully breaks. TP on strong pump when position goes OOR upward (price above all your bins) — close and take profit. If OOR downward (price keeps falling past your range bottom) = cut loss, narrative broke. No re-seed if conviction gone. Do not average down infinitely.",
    },
    best_for:
      "High-conviction 'I believe in this token' recovery plays. Use when you have genuine edge on long-term rebound after 60–80% bleed.",
  },

  spot_wave_enjoyer: {
    id: "spot_wave_enjoyer",
    name: "Spot 1–2 Wave Enjoyer (SPOT TRIFECTA)",
    author: "voidgoesbrr",
    lp_strategy: "spot",
    risk_level: "high",
    token_criteria: {
      min_volume_5m: 100_000,
      notes:
        "Good narrative / legit KOL-backed tokens that are actively pumping. Requires ≥100K volume/5min AND price sitting at a clearly identifiable support level. Do NOT deploy into trending tokens without a visible support — the range must anchor to structure.",
    },
    entry: {
      condition: "Price at latest support level + ≥100K volume/5min confirmed",
      single_side: "sol",
      notes:
        "Single-sided SOL only (amount_y, amount_x=0). Directional bias toward 1–2 retracement waves off support. Set MinPrice% exactly at the latest support level — this is your lower bound. Deploy when volume is active and price has just touched or confirmed support. Spot shape ensures uniform distribution across the wave range.",
    },
    range: {
      type: "moderate",
      bins_below: 25,
      bins_above: 0,
      total_bins: 25,
      notes:
        "Moderate range — set lower bound (bins_below) to exactly match the latest support level as a percentage below entry price. bins_above=0 (SOL-only). Typically 20–30 bins depending on how far support is. Do NOT go wider than needed — this is a precision wave capture, not a wide safety net.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 5,
      trailing_drop_pct: 2,
      oor_timeout_minutes: 20,
      notes:
        "Target 1–2 waves = ~5–10% PnL. Hold 10–20 minutes. Trailing TP activates at 5% and closes on 2% pullback from peak. Exit on OOR immediately — don't wait. Re-seed if momentum continues (price made new high, volume still ≥50K/5min, fresh support formed). Do NOT hold through a failed wave.",
    },
    best_for:
      "Catching short-term retracement waves in pumping coins during moderately dry or steady markets. Part of the SPOT TRIFECTA — precision wave entries for active sessions.",
  },

  spot_npc_default_range: {
    id: "spot_npc_default_range",
    name: "Spot NPC / Default Range 70-bin (SPOT TRIFECTA)",
    author: "voidgoesbrr",
    lp_strategy: "spot",
    risk_level: "medium",
    token_criteria: {
      min_volume_5m: 50_000,
      notes:
        "Good narrative token after initial hype has started (not at the very beginning). Entry trigger: volume spike AND new ATH being made, with ongoing minimum 50K volume/5min sustained. Avoid deploying before the first ATH confirmation — wait for the breakout then enter.",
    },
    entry: {
      condition:
        "Volume spike + new ATH candle confirmed + ongoing ≥50K volume/5min",
      single_side: "sol",
      notes:
        "Single-sided SOL only (amount_y, amount_x=0). Entry after the first significant volume spike and ATH confirmation — you're riding the continued hype, not the initial pump. Spot shape with default 70-bin range at ~80 bin step gives wide coverage for multi-hour holds. Mobile-friendly: once deployed, minimal active management needed.",
    },
    range: {
      type: "wide",
      bins_below: 69,
      bins_above: 0,
      total_bins: 69,
      notes:
        "Default ~70 bins at ~80 bin step. All bins below active bin (SOL-only). Wide coverage allows price to oscillate within a broad range without going OOR. The width is intentional — this is a multi-hour chill position, not a precision entry. bins_above=0.",
    },
    exit: {
      take_profit_pct: null,
      trailing_trigger_pct: 10,
      trailing_drop_pct: 3,
      oor_timeout_minutes: 60,
      min_fee_per_tvl_24h: 3, // lower threshold — consolidation is normal in multi-hour holds
      min_age_for_yield_check_min: 120, // don't close for low yield before 2 hours
      notes:
        "Hold 30 minutes to 6 hours — mobile/class friendly. Trailing TP activates at 10% PnL and closes on 3% pullback from peak (comfortable TP of 10–30%). Manage OOR by closing if narrative fading, or re-seeding at new active bin if hype continues. No stress management required — designed for people who cannot watch the screen.",
    },
    best_for:
      "Chill multi-hour positions after initial hype confirmation. Easy to manage on phone or in class. Part of the SPOT TRIFECTA — the relaxed, wider coverage counterpart to Wave Enjoyer.",
  },
};

// ─── Bootstrap ──────────────────────────────────────────────────

function ensureDefaultStrategies() {
  const db = load();
  let changed = false;

  const needsUpdate = (db.builtin_version ?? 0) < BUILTIN_VERSION;

  for (const [id, strategy] of Object.entries(DEFAULT_STRATEGIES)) {
    const existing = db.strategies[id];
    // Add missing OR update stale built-in (preserves performance data)
    if (!existing || (needsUpdate && existing.author === "meridian")) {
      const prev = existing ?? {};
      db.strategies[id] = {
        ...strategy,
        // Preserve accumulated performance across updates
        performance: prev.performance ?? {
          wins: 0,
          losses: 0,
          total_pnl_pct: 0,
          deployments: 0,
          last_used: null,
        },
        added_at: prev.added_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      changed = true;
    }
  }

  if (needsUpdate) {
    db.builtin_version = BUILTIN_VERSION;
    changed = true;
  }

  // Remove old built-in strategies that are no longer in DEFAULT_STRATEGIES
  if (needsUpdate) {
    for (const id of Object.keys(db.strategies)) {
      if (db.strategies[id].author === "meridian" && !DEFAULT_STRATEGIES[id]) {
        delete db.strategies[id];
        changed = true;
        log("strategy", `Removed stale built-in strategy: ${id}`);
      }
    }
  }

  if (changed) {
    if (!db.active || !db.strategies[db.active])
      db.active = "classic_overnight_bid_ask";
    save(db);
    log("strategy", `Strategy library bootstrapped (v${BUILTIN_VERSION})`);
  }
}

ensureDefaultStrategies();

// ─── Performance Helpers ────────────────────────────────────────

function emptyPerformance() {
  return {
    wins: 0,
    losses: 0,
    total_pnl_pct: 0,
    deployments: 0,
    last_used: null,
  };
}

function formatPerf(p) {
  if (!p || p.deployments === 0) return "no data";
  const avg =
    p.deployments > 0 ? (p.total_pnl_pct / p.deployments).toFixed(1) : "0.0";
  const wr = p.deployments > 0 ? Math.round((p.wins / p.deployments) * 100) : 0;
  return `${p.deployments} trades | ${wr}% win rate | avg PnL ${avg}%`;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Record a closed position's outcome against the strategy that was active at deploy time.
 * Called from executor.js after a successful close_position.
 *
 * @param {string} strategy_id - strategy id used for this position
 * @param {number} pnl_pct     - realised PnL percentage (can be negative)
 */
export function recordStrategyPerformance(strategy_id, pnl_pct) {
  if (!strategy_id || pnl_pct == null) return;
  const db = load();
  const s = db.strategies[strategy_id];
  if (!s) return;

  if (!s.performance) s.performance = emptyPerformance();
  s.performance.deployments += 1;
  s.performance.total_pnl_pct += pnl_pct;
  if (pnl_pct > 0) s.performance.wins += 1;
  else if (pnl_pct < 0) s.performance.losses += 1;
  s.performance.last_used = new Date().toISOString();

  save(db);
  log(
    "strategy",
    `Performance recorded for "${strategy_id}": pnl=${pnl_pct.toFixed(2)}% (${formatPerf(s.performance)})`,
  );
}

/**
 * Recommend the best matching strategy from the library given pool characteristics.
 *
 * @param {object} opts
 * @param {number} opts.volatility       - pool volatility score (0–5+)
 * @param {number} opts.fee_tvl_ratio    - fee / active TVL ratio
 * @param {number} opts.bin_step         - pool bin step
 * @param {boolean} opts.is_automated   - true for cron-driven deployments (prefer low-maintenance)
 * @returns {{ id: string, name: string, reason: string } | null}
 */
export function recommendStrategy({
  volatility = 2,
  fee_tvl_ratio = 0.05,
  bin_step = 100,
  is_automated = true,
  price_vs_ath_pct = null, // e.g. -35 means price is 35% below ATH
  monitoring_available = false, // true if active monitoring is possible right now
} = {}) {
  const db = load();

  const scored = Object.values(db.strategies).map((s) => {
    let score = 0;
    const risk = s.risk_level ?? "medium";

    // Automation / monitoring preference
    if (is_automated && !monitoring_available) {
      // Cron-only, no active monitoring: prefer low-risk set-and-forget plays
      if (risk === "low") score += 30;
      else if (risk === "medium") score += 10;
      else score -= 25; // high-risk strategies need active monitoring
    } else if (monitoring_available) {
      // Active monitoring available: all strategies eligible, boost active ones
      if (s.id === "tight_bid_ask_quick_flips") score += 15;
      if (s.id === "retrace_bid_ask_flip") score += 10;
      if (s.id === "spot_wave_enjoyer") score += 20; // precision wave entries need active monitoring
      if (s.id === "spot_npc_default_range") score += 10; // works attended or unattended
    }

    // Price-vs-ATH fit — most important signal for bid_ask strategies
    if (price_vs_ath_pct != null) {
      const dip = Math.abs(price_vs_ath_pct); // positive = how far below ATH

      if (dip >= 60) {
        // Deep bleed: token-sided recovery or overnight wide
        if (s.id === "token_sided_deep_dump") score += 35;
        if (s.id === "classic_overnight_bid_ask") score += 15;
      } else if (dip >= 30) {
        // Significant dip: classic overnight or tight→wide recovery
        if (s.id === "classic_overnight_bid_ask") score += 30;
        if (s.id === "tight_wide_token_recovery") score += 20;
      } else if (dip >= 10) {
        // Moderate dip / retrace: retrace flip, tight flips, or wave enjoyer
        if (s.id === "retrace_bid_ask_flip") score += 30;
        if (s.id === "tight_bid_ask_quick_flips") score += 20;
        if (s.id === "spot_wave_enjoyer") score += 20; // wave enjoyer excels at moderate dips to support
      } else if (dip <= 5) {
        // Near ATH / just broken out: NPC default range or AFK passive
        if (s.id === "spot_npc_default_range") score += 35; // ATH breakout with volume = NPC entry signal
        if (s.id === "afk_passive_bid_ask") score += 20;
        if (s.id === "retrace_bid_ask_flip") score += 15;
      }
    }

    // Volatility fit
    if (volatility <= 1.5) {
      // Calm/low vol: AFK passive or overnight wide
      if (s.id === "afk_passive_bid_ask") score += 20;
      if (s.id === "classic_overnight_bid_ask") score += 15;
      if (s.id === "spot_npc_default_range") score += 10; // NPC works in calm markets too
    } else if (volatility <= 3) {
      // Moderate vol: classic overnight, retrace flip, wave enjoyer, NPC
      if (s.id === "classic_overnight_bid_ask") score += 20;
      if (s.id === "retrace_bid_ask_flip") score += 15;
      if (s.id === "tight_wide_token_recovery") score += 10;
      if (s.id === "spot_wave_enjoyer") score += 20; // moderate vol = clear wave structure
      if (s.id === "spot_npc_default_range") score += 15; // moderate vol = multi-hour hold viable
    } else {
      // High vol: tight flips capture fee spikes; token recovery if deep dump
      if (s.id === "tight_bid_ask_quick_flips") score += 25;
      if (s.id === "retrace_bid_ask_flip") score += 15;
      if (s.id === "token_sided_deep_dump") score += 10;
      if (s.id === "spot_wave_enjoyer") score += 10; // wave enjoyer can work in high vol with good support
    }

    // Fee/TVL fit — higher fee = more active pool, better for tight/quick strategies
    if (fee_tvl_ratio >= 0.2) {
      // Very high fee: tight flips and retrace flip benefit most; wave enjoyer thrives
      if (s.id === "tight_bid_ask_quick_flips") score += 20;
      if (s.id === "retrace_bid_ask_flip") score += 15;
      if (s.id === "spot_wave_enjoyer") score += 15; // high fee = active pool = clear wave structure
    } else if (fee_tvl_ratio >= 0.1) {
      if (s.id === "classic_overnight_bid_ask") score += 10;
      if (s.id === "retrace_bid_ask_flip") score += 10;
      if (s.id === "spot_npc_default_range") score += 10; // moderate fee = sustained hype = NPC viable
      if (s.id === "spot_wave_enjoyer") score += 8;
    } else if (fee_tvl_ratio >= 0.05) {
      if (s.id === "afk_passive_bid_ask") score += 10;
      if (s.id === "classic_overnight_bid_ask") score += 5;
      if (s.id === "spot_npc_default_range") score += 5;
    }

    // Boost strategies with a proven track record in current conditions
    const perf = s.performance;
    if (perf && perf.deployments >= 3) {
      const avgPnl = perf.total_pnl_pct / perf.deployments;
      const winRate = perf.wins / perf.deployments;
      if (avgPnl > 5 && winRate > 0.6) score += 20;
      else if (avgPnl > 0) score += 10;
      else if (avgPnl < -5) score -= 15; // proven loser in this context
    }

    return { ...s, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  const best = scored[0];
  if (!best || best._score <= 0) return null;

  const reason = [
    `volatility=${volatility.toFixed(1)}`,
    `fee_tvl=${fee_tvl_ratio.toFixed(2)}`,
    `bin_step=${bin_step}`,
    price_vs_ath_pct != null ? `price_vs_ath=${price_vs_ath_pct}%` : null,
    monitoring_available ? "monitoring=active" : "monitoring=cron_only",
    best.performance?.deployments > 0
      ? `track_record=(${formatPerf(best.performance)})`
      : "no prior data",
  ]
    .filter(Boolean)
    .join(", ");

  return { id: best.id, name: best.name, reason };
}

/**
 * Generate a concise prompt block for the screener agent describing the active strategy.
 * Richer than the inline string in index.js — includes risk level, range params, and entry notes.
 *
 * @returns {string}
 */
export function getStrategyPromptBlock() {
  const db = load();
  const s = db.active ? db.strategies[db.active] : null;

  if (!s) {
    return "No active strategy — use default spot shape, bins_below=52, bins_above=17, dual-sided.";
  }

  const perf = s.performance;
  const perfStr =
    perf && perf.deployments > 0 ? ` | track_record: ${formatPerf(perf)}` : "";
  const riskStr = s.risk_level ? ` | risk: ${s.risk_level.toUpperCase()}` : "";

  const lines = [
    `ACTIVE STRATEGY: ${s.name}${riskStr}`,
    `  shape: ${s.lp_strategy} | bins_below: ${s.range?.bins_below ?? 52} | bins_above: ${s.range?.bins_above ?? 0} (FIXED — never change)`,
    `  deposit: ${s.entry?.single_side === "token" ? "token-only (amount_x only, amount_y=0)" : s.entry?.single_side === "sol" ? "SOL-only (amount_y only, amount_x=0)" : "dual-sided (default)"}`,
    `  entry: ${s.entry?.notes ?? s.entry?.condition ?? "deploy normally"}`,
    `  exit: ${s.exit?.notes ?? (s.exit?.take_profit_pct ? `take profit at ${s.exit.take_profit_pct}%` : "use default OOR/trailing TP rules")}`,
    `  best_for: ${s.best_for}${perfStr}`,
  ];

  return lines.join("\n");
}

/**
 * Add or update a strategy.
 * The agent parses a raw tweet/text and fills in the structured fields.
 */
export function addStrategy({
  id,
  name,
  author = "unknown",
  lp_strategy = "spot",
  risk_level = "medium",
  token_criteria = {},
  entry = {},
  range = {},
  exit = {},
  best_for = "",
  raw = "",
}) {
  if (!id || !name) return { error: "id and name are required" };

  // Validate lp_strategy
  const validShapes = ["spot", "bid_ask", "curve", "mixed", "any"];
  if (!validShapes.includes(lp_strategy)) {
    return { error: `lp_strategy must be one of: ${validShapes.join(", ")}` };
  }

  // Validate risk_level
  const validRisks = ["low", "medium", "high"];
  if (!validRisks.includes(risk_level)) {
    return { error: `risk_level must be one of: ${validRisks.join(", ")}` };
  }

  // Slugify id
  const slug = id
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!slug) return { error: "id produced an empty slug after sanitisation" };

  const db = load();

  // Preserve performance data if overwriting an existing strategy
  const existing = db.strategies[slug];
  const performance = existing?.performance ?? emptyPerformance();

  db.strategies[slug] = {
    id: slug,
    name,
    author,
    lp_strategy,
    risk_level,
    token_criteria,
    entry,
    range: {
      bins_below: range.bins_below ?? 52,
      bins_above: range.bins_above ?? 0,
      total_bins: (range.bins_below ?? 52) + (range.bins_above ?? 0),
      ...range,
    },
    exit,
    best_for,
    raw,
    performance,
    added_at: existing?.added_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!db.active) db.active = slug;

  save(db);
  log("strategy", `Strategy saved: ${name} (${slug})`);
  return { saved: true, id: slug, name, active: db.active === slug };
}

/**
 * List all strategies with a summary including performance stats.
 */
export function listStrategies() {
  const db = load();
  const strategies = Object.values(db.strategies).map((s) => ({
    id: s.id,
    name: s.name,
    author: s.author,
    lp_strategy: s.lp_strategy,
    risk_level: s.risk_level ?? "unknown",
    best_for: s.best_for,
    active: db.active === s.id,
    performance: s.performance ? formatPerf(s.performance) : "no data",
    added_at: s.added_at?.slice(0, 10),
  }));
  return { active: db.active, count: strategies.length, strategies };
}

/**
 * Get full details of a strategy including raw text, all criteria, and performance.
 */
export function getStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  const strategy = db.strategies[id];
  if (!strategy)
    return {
      error: `Strategy "${id}" not found`,
      available: Object.keys(db.strategies),
    };
  return {
    ...strategy,
    is_active: db.active === id,
    performance_summary: formatPerf(strategy.performance),
  };
}

/**
 * Set the active strategy used during screening cycles.
 */
export function setActiveStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  if (!db.strategies[id])
    return {
      error: `Strategy "${id}" not found`,
      available: Object.keys(db.strategies),
    };
  db.active = id;
  save(db);
  log("strategy", `Active strategy set to: ${db.strategies[id].name}`);
  return { active: id, name: db.strategies[id].name };
}

/**
 * Remove a strategy.
 * Built-in meridian strategies are protected and cannot be deleted.
 */
export function removeStrategy({ id }) {
  if (!id) return { error: "id required" };
  const db = load();
  const strategy = db.strategies[id];
  if (!strategy) return { error: `Strategy "${id}" not found` };

  // Protect built-in strategies
  if (strategy.author === "meridian") {
    return {
      error: `Cannot remove built-in strategy "${id}". Use set_active_strategy to switch away from it instead.`,
    };
  }

  const name = strategy.name;
  delete db.strategies[id];
  if (db.active === id) db.active = Object.keys(db.strategies)[0] || null;
  save(db);
  log("strategy", `Strategy removed: ${name}`);
  return { removed: true, id, name, new_active: db.active };
}

/**
 * Get the currently active strategy — used by screening and management cycles.
 * Returns null if no strategy is active.
 */
export function getActiveStrategy() {
  const db = load();
  if (!db.active || !db.strategies[db.active]) return null;
  return db.strategies[db.active];
}
