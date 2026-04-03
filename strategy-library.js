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
const BUILTIN_VERSION = 3;

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
  spot_wide: {
    id: "spot_wide",
    name: "Spot Wide — Safe Automation",
    author: "meridian",
    lp_strategy: "spot",
    risk_level: "low",
    token_criteria: {
      notes:
        "Any token with consistent volume. Ideal for pools where price action is moderate and organic score is high.",
    },
    entry: {
      condition: "Deploy dual-sided with spot shape across a wide bin range",
      single_side: null,
      notes:
        "Equal liquidity distribution across 50–69 bins. Bot-friendly: stays in range longer, earns steady fees with minimal rebalancing.",
    },
    range: {
      type: "wide",
      bins_below: 52,
      bins_above: 17,
      total_bins: 69,
      notes:
        "Wide range reduces OOR risk. bins_below > bins_above for slight bullish lean. Adjust ratio via custom_ratio_spot if stronger directional view.",
    },
    exit: {
      take_profit_pct: null,
      notes:
        "Let trailing TP or OOR timeout handle exit. No manual TP needed — wide range means fees compound well over time.",
    },
    best_for:
      "Automated bots, low-monitoring setups, tokens with moderate volatility and consistent volume",
  },

  custom_ratio_spot: {
    id: "custom_ratio_spot",
    name: "Custom Ratio Spot",
    author: "meridian",
    lp_strategy: "spot",
    risk_level: "medium",
    token_criteria: {
      notes: "Any token. Ratio expresses directional bias.",
    },
    entry: {
      condition: "Directional view on token",
      single_side: null,
      notes:
        "75% token = bullish (sell on pump out of range). 75% SOL = bearish/DCA-in (buy on dip). Set bins_below:bins_above proportional to token:SOL ratio.",
    },
    range: {
      type: "custom",
      bins_below: 52,
      bins_above: 17,
      total_bins: 69,
      notes:
        "bins_below:bins_above ratio matches token:SOL ratio. E.g., 75% token → ~52 bins below, ~17 bins above. Adjust per conviction.",
    },
    exit: {
      take_profit_pct: 10,
      notes:
        "Close when OOR or TP hit. Re-deploy with updated ratio based on new momentum signals.",
    },
    best_for: "Expressing directional bias while earning fees both ways",
  },

  single_sided_reseed: {
    id: "single_sided_reseed",
    name: "Single-Sided Bid-Ask + Re-seed",
    author: "meridian",
    lp_strategy: "bid_ask",
    risk_level: "high",
    token_criteria: {
      notes:
        "Volatile tokens with strong narrative. Must have active volume. HIGH RISK — only use on tokens with strong conviction.",
    },
    entry: {
      condition:
        "Deploy token-only (amount_x only, amount_y=0) bid-ask, bins below active bin only",
      single_side: "token",
      notes:
        "As price drops through bins, token sold for SOL. Bid-ask concentrates at bottom edge. No SOL required at entry.",
    },
    range: {
      type: "single_sided_below",
      bins_below: 69,
      bins_above: 0,
      total_bins: 69,
      notes: "All bins below active bin. bins_above=0. Token-only deploy.",
    },
    exit: {
      take_profit_pct: null,
      notes:
        "When OOR downside: close_position(skip_swap=true) → redeploy token-only bid-ask at new lower price. Do NOT swap to SOL between re-seeds. Full close only when token dead or after N re-seeds with declining performance.",
    },
    best_for:
      "Riding volatile tokens down without cutting losses. DCA out via LP.",
  },

  fee_compounding: {
    id: "fee_compounding",
    name: "Fee Compounding",
    author: "meridian",
    lp_strategy: "spot",
    risk_level: "low",
    token_criteria: {
      notes:
        "Stable volume pools with consistent fee generation. Look for fee_per_tvl_24h > 7%.",
    },
    entry: {
      condition: "Deploy with spot shape on a high-volume stable pool",
      single_side: null,
      notes:
        "Strategy is about management cadence, not entry shape. Wide spot range preferred so position stays in range while fees accumulate.",
    },
    range: {
      type: "wide",
      bins_below: 52,
      bins_above: 17,
      total_bins: 69,
      notes:
        "Standard wide range. Staying in range is critical — fees can only be compounded while active.",
    },
    exit: {
      take_profit_pct: null,
      notes:
        "When unclaimed fees > $5 AND in range: claim_fees → add_liquidity back into same position. Normal close rules otherwise (OOR timeout, stop loss).",
    },
    best_for: "Maximizing yield on stable, range-bound pools via compounding",
  },

  multi_layer: {
    id: "multi_layer",
    name: "Multi-Layer Composite",
    author: "meridian",
    lp_strategy: "mixed",
    risk_level: "medium",
    token_criteria: {
      notes:
        "High volume pools. Best when you want custom fee capture — heavy at edges AND center simultaneously.",
    },
    entry: {
      condition:
        "Create ONE position, then layer additional shapes onto it with add-liquidity",
      single_side: null,
      notes:
        "Step 1: deploy (creates position with first shape). Step 2+: add-liquidity to same position with different shapes. All layers share the same bin range — distribution curves stack on top of each other.",
      example_patterns: {
        smooth_edge:
          "Deploy Bid-Ask (edges) → add-liquidity Spot (fills the middle gap). 2 layers, 1 position.",
        full_composite:
          "Deploy Bid-Ask (edges) → add-liquidity Spot (middle) → add-liquidity Curve (center boost). 3 layers, 1 position.",
        edge_heavy:
          "Deploy Bid-Ask → add-liquidity Bid-Ask again (double edge weight). 2 layers, 1 position.",
      },
    },
    range: {
      type: "custom",
      bins_below: 52,
      bins_above: 17,
      total_bins: 69,
      notes:
        "All layers share the position's bin range (set at deploy). Choose range wide enough for the widest layer needed.",
    },
    exit: {
      take_profit_pct: null,
      notes:
        "Single position — one close, one claim. The composite shape means fees earned reflect ALL layers combined.",
    },
    best_for:
      "Creating custom liquidity distributions by stacking shapes in one position. Single position to manage.",
  },

  partial_harvest: {
    id: "partial_harvest",
    name: "Partial Harvest",
    author: "meridian",
    lp_strategy: "spot",
    risk_level: "low",
    token_criteria: {
      notes:
        "High fee pools where taking profit incrementally is preferred. Apply to any winning position at 10%+ return.",
    },
    entry: {
      condition: "Deploy normally with spot shape",
      single_side: null,
      notes:
        "Strategy is about progressive profit-taking, not entry shape. Use on positions already performing well.",
    },
    range: {
      type: "wide",
      bins_below: 52,
      bins_above: 17,
      total_bins: 69,
      notes: "Standard wide range.",
    },
    exit: {
      take_profit_pct: 10,
      notes:
        "When total return >= 10% of deployed capital: withdraw_liquidity(bps=5000) to take 50% off table. Remaining 50% keeps running. Repeat at each subsequent 10% threshold.",
    },
    best_for: "Locking in profits without fully exiting winning positions",
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

  if (changed) {
    if (!db.active || !db.strategies[db.active]) db.active = "spot_wide";
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
} = {}) {
  const db = load();

  const scored = Object.values(db.strategies).map((s) => {
    let score = 0;
    const risk = s.risk_level ?? "medium";

    // Automation preference — low-risk strategies favored for cron deployments
    if (is_automated) {
      if (risk === "low") score += 30;
      else if (risk === "medium") score += 10;
      else score -= 20; // penalise high-risk for automated use
    }

    // Volatility fit
    if (volatility <= 1.5) {
      // Calm market: fee compounding and spot wide shine
      if (s.id === "fee_compounding") score += 25;
      if (s.id === "spot_wide") score += 20;
    } else if (volatility <= 3) {
      // Moderate: custom ratio spot or spot wide
      if (s.id === "custom_ratio_spot") score += 25;
      if (s.id === "spot_wide") score += 15;
      if (s.id === "multi_layer") score += 10;
    } else {
      // High: bid-ask captures edge volatility; reseed for strong narratives
      if (s.id === "single_sided_reseed") score += 15;
      if (s.id === "multi_layer") score += 20;
      if (s.id === "partial_harvest") score += 10;
    }

    // Fee/TVL fit
    if (fee_tvl_ratio >= 0.15) {
      // High-fee pool: compounding adds most value
      if (s.id === "fee_compounding") score += 20;
      if (s.id === "partial_harvest") score += 15;
    } else if (fee_tvl_ratio >= 0.05) {
      if (s.id === "spot_wide") score += 10;
    }

    // Boost strategies with a proven track record
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
    best.performance?.deployments > 0
      ? `track_record=(${formatPerf(best.performance)})`
      : "no prior data",
  ].join(", ");

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
