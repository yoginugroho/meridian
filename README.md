# Meridian

**Autonomous Meteora DLMM liquidity management agent for Solana, powered by LLMs.**

Meridian runs continuous screening and management cycles, deploying capital into high-quality Meteora DLMM pools and closing positions based on live PnL, yield, and range data. It learns from every position it closes.

---

## What it does

- **Screens pools** — scans Meteora DLMM pools against configurable thresholds (fee/TVL ratio, organic score, holder count, mcap, bin step) and surfaces high-quality opportunities
- **Manages positions** — monitors, claims fees, and closes LP positions autonomously; decides to STAY, CLOSE, or REDEPLOY based on live data
- **Strategy library** — 8 built-in LP strategies (bid-ask, spot, two-phase flips) each with their own exit rules that override global defaults per-position
- **Learns from performance** — studies top LPers in target pools, saves structured lessons, and evolves screening thresholds based on closed position history
- **Discord signals** — optional Discord listener watches LP Army channels for Solana token calls and queues them for screening
- **Telegram chat** — full agent chat via Telegram, plus cycle reports and OOR alerts
- **Claude Code integration** — run AI-powered screening and management directly from your terminal using Claude Code slash commands

---

## How it works

Meridian runs a **ReAct agent loop** — each cycle the LLM reasons over live data, calls tools, and acts. Two specialized agents run on independent cron schedules:

| Agent | Default interval | Role |
|---|---|---|
| **Screening Agent** | Every 30 min | Pool screening — finds and deploys into the best candidate |
| **Management Agent** | Every 10 min | Position management — evaluates each open position and acts |

**Data sources:**
- `@meteora-ag/dlmm` SDK — on-chain position data, active bin, deploy/close transactions
- Meteora DLMM PnL API — position yield, fee accrual, PnL
- OKX OnchainOS — smart money signals, token risk scoring
- Pool screening API — fee/TVL ratios, volume, organic scores, holder counts
- Jupiter API — token audit, mcap, launchpad, price stats

Agents are powered via **OpenRouter** and can be swapped for any compatible model.

---

## Requirements

- Node.js 18+
- [OpenRouter](https://openrouter.ai) API key
- Solana wallet (base58 private key)
- Solana RPC endpoint ([Helius](https://helius.xyz) recommended)
- Telegram bot token (optional)
- [Claude Code](https://claude.ai/code) CLI (optional, for terminal slash commands)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/yunus-0x/meridian
cd meridian
npm install
```

### 2. Run the setup wizard

```bash
npm run setup
```

The wizard walks you through creating `.env` (API keys, wallet, RPC, Telegram) and `user-config.json` (risk preset, deploy size, thresholds, models). Takes about 2 minutes.

**Or set up manually:**

Create `.env`:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OPENROUTER_API_KEY=sk-or-...
HELIUS_API_KEY=your_helius_key          # for wallet balance lookups
TELEGRAM_BOT_TOKEN=123456:ABC...        # optional — for notifications + chat
TELEGRAM_CHAT_ID=                       # auto-filled on first message
DRY_RUN=true                            # set false for live trading
```

> Never put your private key or API keys in `user-config.json` — use `.env` only. Both files are gitignored.

Copy config and edit as needed:

```bash
cp user-config.example.json user-config.json
```

See [Config reference](#config-reference) below.

### 3. Run

```bash
npm run dev    # dry run — no on-chain transactions
npm start      # live mode
```

On startup Meridian fetches your wallet balance, open positions, and top pool candidates, then begins autonomous cycles immediately.

---

## Running modes

### Autonomous agent

```bash
npm start
```

Starts the full autonomous agent with cron-based screening + management cycles and an interactive REPL. The prompt shows a live countdown to the next cycle:

```
[manage: 8m 12s | screen: 24m 3s]
>
```

REPL commands:

| Command | Description |
|---|---|
| `/status` | Wallet balance and open positions |
| `/candidates` | Re-screen and display top pool candidates |
| `/learn` | Study top LPers across all current candidate pools |
| `/learn <pool_address>` | Study top LPers for a specific pool |
| `/thresholds` | Current screening thresholds and performance stats |
| `/evolve` | Trigger threshold evolution from performance data (needs 5+ closed positions) |
| `/briefing` | Generate and display the daily performance briefing |
| `/stop` | Graceful shutdown |
| `1`, `2`, `3`... | Deploy into a startup candidate by list number |
| `auto` | Agent picks the best candidate and deploys automatically |
| `go` | Start cron cycles without deploying anything first |
| `<anything>` | Free-form chat — ask the agent anything, request actions, analyze pools |

---

### Claude Code terminal (recommended)

Install [Claude Code](https://claude.ai/code) and use it from inside the meridian directory. Claude Code has built-in agents and slash commands that use the `meridian` CLI under the hood.

```bash
cd meridian
claude
```

#### Slash commands

| Command | What it does |
|---|---|
| `/screen` | Full AI screening cycle — checks Discord queue, reads config, fetches candidates, runs deep research, and deploys if a winner is found |
| `/manage` | Full AI management cycle — checks all positions, evaluates PnL, claims fees, closes OOR/losing positions |
| `/balance` | Check wallet SOL and token balances |
| `/positions` | List all open DLMM positions with range status |
| `/candidates` | Fetch and enrich top pool candidates (pool metrics + token audit + smart money) |
| `/study-pool` | Study top LPers on a specific pool |
| `/pool-ohlcv` | Fetch price/volume history for a pool |
| `/pool-compare` | Compare all Meteora DLMM pools for a token pair by APR, fee/TVL ratio, and volume |

#### Claude Code agents

Two specialized sub-agents run inside Claude Code:

**`screener`** — pool screening specialist. Invoke when you want to evaluate candidates, analyse token risk, or deploy a position. Has access to OKX smart money signals, full token audit pipeline, and all strategy logic.

**`manager`** — position management specialist. Invoke when reviewing open positions, assessing PnL, claiming fees, or closing positions.

To trigger an agent directly, just describe what you want:
```
> screen for new pools and deploy if you find something good
> review all my positions and close anything out of range
> what do you think of the SOL/BONK pool?
```

#### Loop mode

Run screening or management on a timer inside Claude Code:

```
/loop 30m /screen     # screen every 30 minutes
/loop 10m /manage     # manage every 10 minutes
```

---

### CLI (direct tool invocation)

The `meridian` CLI gives you direct access to every tool with JSON output — useful for scripting, debugging, or piping into other tools.

```bash
npm install -g .   # install globally (once)
meridian <command> [flags]
```

Or run without installing:

```bash
node cli.js <command> [flags]
```

**Positions & PnL**

```bash
meridian positions
meridian pnl <position_address>
meridian wallet-positions --wallet <addr>
```

**Screening**

```bash
meridian candidates --limit 5
meridian pool-detail --pool <addr> [--timeframe 5m]
meridian active-bin --pool <addr>
meridian search-pools --query <name_or_symbol>
meridian study --pool <addr> [--limit 4]
```

**Token research**

```bash
meridian token-info --query <mint_or_symbol>
meridian token-holders --mint <addr> [--limit 20]
meridian token-narrative --mint <addr>
```

**Deploy & manage**

```bash
meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot] [--strategy-id <id>] [--dry-run]
meridian claim --position <addr>
meridian close --position <addr> [--skip-swap] [--dry-run]
meridian swap --from <mint> --to <mint> --amount <n> [--dry-run]
meridian add-liquidity --position <addr> --pool <addr> [--amount-x <n>] [--amount-y <n>] [--strategy spot]
meridian withdraw-liquidity --position <addr> --pool <addr> [--bps 10000]
```

**Agent cycles**

```bash
meridian screen [--dry-run] [--silent]   # one AI screening cycle
meridian manage [--dry-run] [--silent]   # one AI management cycle
meridian start [--dry-run]               # start autonomous agent with cron jobs
```

**Config**

```bash
meridian config get
meridian config set <key> <value>
```

**Strategies**

```bash
meridian strategies list
meridian strategies get <id>
meridian strategies set-active <id>
```

**Learning & memory**

```bash
meridian lessons
meridian lessons add "your lesson text"
meridian performance [--limit 200]
meridian evolve
meridian pool-memory --pool <addr>
```

**Blacklist**

```bash
meridian blacklist list
meridian blacklist add --mint <addr> --reason "reason"
```

**Discord signals**

```bash
meridian discord-signals
meridian discord-signals clear
```

**Balance**

```bash
meridian balance
```

**Flags**

| Flag | Effect |
|---|---|
| `--dry-run` | Skip all on-chain transactions |
| `--silent` | Suppress Telegram notifications for this run |

---

## Discord listener

The Discord listener watches configured channels (e.g. LP Army) for Solana token calls and queues them as signals for the screener agent.

### Setup

```bash
cd discord-listener
npm install
```

Add to your root `.env`:

```env
DISCORD_USER_TOKEN=your_discord_account_token   # from browser DevTools → Network
DISCORD_GUILD_ID=the_server_id
DISCORD_CHANNEL_IDS=channel1,channel2            # comma-separated
DISCORD_MIN_FEES_SOL=5                           # minimum pool fees to pass pre-check
```

> This uses a selfbot (personal account automation, not a bot token). Use responsibly.

### Run

```bash
cd discord-listener
npm start
```

Or run it in a separate terminal alongside the main agent. Signals are written to `discord-signals.json` and picked up automatically by `/screen` and `node cli.js screen`.

### Signal pipeline

Each incoming token address passes through a pre-check pipeline before being queued:
1. **Dedup** — ignores addresses seen in the last 10 minutes
2. **Blacklist** — rejects blacklisted token mints
3. **Pool resolution** — resolves the address to a Meteora DLMM pool
4. **Rug check** — checks deployer against `deployer-blacklist.json`
5. **Fees check** — rejects pools below `DISCORD_MIN_FEES_SOL`

Signals that pass all checks are queued with status `pending`. The screener picks up pending signals and processes them as priority candidates before running the normal screening cycle.

### Deployer blacklist

Add known rug/farm deployer wallet addresses to `deployer-blacklist.json`:

```json
{
  "_note": "Known farm/rug deployers — add addresses to auto-reject their pools",
  "addresses": [
    "WaLLeTaDDressHere"
  ]
}
```

---

## Telegram

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Add `TELEGRAM_BOT_TOKEN=<token>` to your `.env`
3. Start the agent, then send any message to your bot — it auto-registers your chat ID

### Notifications

Meridian sends notifications automatically for:
- Management cycle reports (reasoning + decisions)
- Screening cycle reports (what it found, whether it deployed)
- OOR alerts when a position leaves range past `outOfRangeWaitMinutes`
- Deploy: pair, amount, position address, tx hash
- Close: pair and PnL

### Telegram commands

| Command | Action |
|---|---|
| `/positions` | List open positions with progress bar |
| `/close <n>` | Close position by list index |
| `/set <n> <note>` | Set a note or instruction on a position |

You can also chat freely via Telegram using the same interface as the REPL.

---

## Config reference

All fields are optional — defaults shown. Edit `user-config.json` directly or use `update_config` via the agent chat.

### Screening

| Field | Default | Description |
|---|---|---|
| `timeframe` | `5m` | Candle timeframe for pool metrics (`5m` `15m` `1h` `2h` `4h` `12h` `24h`) |
| `category` | `trending` | Pool category filter |
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio (interpret relative to timeframe — see table below) |
| `minTvl` | `10000` | Minimum pool TVL (USD) |
| `maxTvl` | `150000` | Maximum pool TVL (USD) |
| `minVolume` | `500` | Minimum pool volume over timeframe window |
| `minOrganic` | `60` | Minimum organic score (0–100) |
| `minHolders` | `500` | Minimum token holder count |
| `minMcap` | `150000` | Minimum market cap (USD) |
| `maxMcap` | `10000000` | Maximum market cap (USD) |
| `minBinStep` | `80` | Minimum pool bin step |
| `maxBinStep` | `125` | Maximum pool bin step |
| `minTokenFeesSol` | `30` | Minimum all-time fees paid in SOL (below = bundled/scam) |
| `maxBundlePct` | `30` | Maximum bundle holding % (OKX advanced-info) |
| `maxBotHoldersPct` | `30` | Maximum bot holder addresses % (Jupiter audit) |
| `maxTop10Pct` | `60` | Maximum top-10 holder concentration % |
| `blockedLaunchpads` | `[]` | Launchpad names to never deploy into (e.g. `["pump.fun"]`) |
| `minTokenAgeHours` | `null` | Minimum token age in hours (`null` = no minimum) |
| `maxTokenAgeHours` | `null` | Maximum token age in hours (`null` = no maximum) |
| `athFilterPct` | `null` | Only deploy if price is within X% of ATH (e.g. `-20` = within 20% below ATH) |
| `maxNewWalletPct` | `null` | Skip if more than X% of holders are fresh wallets (snipe signal) |

**fee/active-TVL ratio by timeframe** (for `minFeeActiveTvlRatio`):

| Timeframe | Decent | Strong |
|---|---|---|
| `5m` | ≥ 0.02 | ≥ 0.05 |
| `15m` | ≥ 0.05 | ≥ 0.10 |
| `1h` | ≥ 0.20 | ≥ 0.50 |
| `2h` | ≥ 0.40 | ≥ 1.00 |
| `4h` | ≥ 0.80 | ≥ 2.00 |
| `24h` | ≥ 3.00 | ≥ 8.00 |

### Management

| Field | Default | Description |
|---|---|---|
| `deployAmountSol` | `0.5` | Base SOL per new position (floor for compounding formula) |
| `positionSizePct` | `0.35` | Fraction of deployable wallet balance to use per position |
| `maxDeployAmount` | `50` | Hard cap on SOL per position |
| `gasReserve` | `0.2` | Minimum SOL to keep for gas |
| `minSolToOpen` | `0.55` | Minimum wallet SOL before opening a new position |
| `stopLossPct` | `-50` | Close when total position PnL drops to this % |
| `takeProfitFeePct` | `5` | Global hard take-profit % — close when PnL reaches this. Set high (e.g. `100`) to rely on trailing TP only. Strategies with an active strategy set override this per-position. |
| `trailingTakeProfit` | `true` | Master switch for trailing take-profit. Must be `true` for trailing to activate on positions without strategy metadata. Strategy positions are always protected regardless of this flag. |
| `trailingTriggerPct` | `3` | Activate trailing TP when position PnL reaches +X% |
| `trailingDropPct` | `1.5` | Fire trailing TP when PnL drops X% from its peak |
| `outOfRangeBinsToClose` | `10` | Close immediately if active bin is more than X bins above upper bin (pumped far above range) |
| `outOfRangeWaitMinutes` | `30` | Minutes OOR before closing (global default — strategies override per-position) |
| `minFeePerTvl24h` | `7` | Close in-range positions earning less than X% fee/TVL per day (opportunity cost exit). Strategies override per-position. |
| `minAgeBeforeYieldCheck` | `60` | Minutes a position must be open before low-yield exit can trigger |
| `minClaimAmount` | `5` | Minimum unclaimed fees (USD) before claiming |
| `autoSwapAfterClaim` | `false` | Auto-swap base tokens to SOL after every fee claim |
| `solMode` | `false` | Report positions, PnL, and balances in SOL instead of USD |

**Position size compounding formula:**

```
deployable = walletSol - gasReserve
size = clamp(deployable × positionSizePct, floor=deployAmountSol, ceil=maxDeployAmount)
```

Examples at defaults (gasReserve=0.2, positionSizePct=0.35, floor=0.5):

| Wallet | Deploy size |
|---|---|
| 0.8 SOL | 0.5 SOL (floor) |
| 2.0 SOL | 0.63 SOL |
| 4.0 SOL | 1.33 SOL |
| 10 SOL | 3.43 SOL |

### Schedule

| Field | Default | Description |
|---|---|---|
| `managementIntervalMin` | `10` | Management cycle frequency (minutes) |
| `screeningIntervalMin` | `30` | Screening cycle frequency (minutes) |
| `healthCheckIntervalMin` | `60` | Health check / state sync frequency (minutes) |

### Models

| Field | Default | Description |
|---|---|---|
| `managementModel` | `openrouter/healer-alpha` | LLM for management cycles |
| `screeningModel` | `openrouter/hunter-alpha` | LLM for screening cycles |
| `generalModel` | `openrouter/healer-alpha` | LLM for REPL / chat |

> Override model at runtime: `node cli.js config set screeningModel anthropic/claude-opus-4-5`

---

## Strategy library

Meridian has a built-in library of 8 LP strategies. Each strategy defines:
- **Entry conditions** — what kind of token/pool to look for
- **Range config** — bin shape, `bins_below`, `bins_above`
- **Exit rules** — per-strategy `take_profit_pct`, `trailing_trigger_pct`, `trailing_drop_pct`, `oor_timeout_minutes` that override the global config for each position

When an active strategy is set, its exit rules are written to every deployed position at deploy time. This means two positions in the same pool can have different TP/SL behaviour if they were deployed under different strategies.

### Setting the active strategy

```bash
# via agent chat
> set active strategy to spot_wave_enjoyer

# via CLI
node cli.js strategies set-active spot_wave_enjoyer

# via config tool
update_config { strategy_id: "spot_wave_enjoyer" }
```

### Passing strategy_id directly on deploy

If no active strategy is set, you can still attach a strategy's exit rules to a specific deploy by passing `strategy_id` to `deploy_position`:

```
> deploy 0.5 SOL into pool XYZ using spot_wave_enjoyer strategy
```

The agent will pass `strategy_id: "spot_wave_enjoyer"` in the tool call and the exit parameters will be applied automatically.

### Built-in strategies

| ID | Name | Risk | Shape | Entry | Exit |
|---|---|---|---|---|---|
| `classic_overnight_bid_ask` | Classic / Overnight Bid-Ask | Medium | Wide SOL-only | Post-dip runner, -20–40% from ATH | Trailing TP: activates at 7%, closes on 2% drop |
| `retrace_bid_ask_flip` | Retrace Bid-Ask Flip | Medium | Tight SOL→Token two-phase | Retrace before pump back to ATH | Phase 1→2 flip; trailing TP: trigger 10%, drop 3% |
| `tight_bid_ask_quick_flips` | Tight Bid-Ask Quick Flips | High | Tight SOL-only | Dump into range, short bounce | Trailing TP: trigger 4%, drop 1.5%; OOR timeout 5m |
| `tight_wide_token_recovery` | Tight → Wide Token Recovery | Medium | Tight SOL→Wide Token two-phase | ~40% dump with strong narrative | Phase 1→2 flip; trailing TP: trigger 15%, drop 5% |
| `afk_passive_bid_ask` | AFK / Passive Bid-Ask | Low | VPVR-concentrated SOL-only | Token at ATH, don't chase — use VPVR zone | Trailing TP: trigger 6%, drop 2%; OOR timeout 3h |
| `token_sided_deep_dump` | Token-Sided on Deep Dumps | High | Wide token-only upside | 60–80% dump, buy token first then deploy | Trailing TP: trigger 20%, drop 5%; OOR down = instant cut |
| `spot_wave_enjoyer` | Spot 1–2 Wave Enjoyer | High | Moderate SOL-only spot | Price at support + ≥100K vol/5min | Trailing TP: trigger 5%, drop 2%; OOR timeout 20m |
| `spot_npc_default_range` | Spot NPC / Default 70-bin | Medium | Wide SOL-only spot | Volume spike + new ATH confirmed | Trailing TP: trigger 10%, drop 3%; OOR timeout 60m; min yield 3% |

### Two-phase strategies

`retrace_bid_ask_flip` and `tight_wide_token_recovery` use an automatic Phase 1 → Phase 2 flip:

1. **Phase 1** — deploy SOL-only on tight bid-ask below current price. As price falls through the range, SOL is gradually converted to tokens.
2. **Flip trigger** — when the active bin drops below the lower bin (all SOL converted), the management cycle automatically closes Phase 1 and redeploys the recovered tokens into Phase 2.
3. **Phase 2** — token-only bid-ask with wide upside bins. As price recovers upward through the range, tokens are sold back for SOL, capturing fees on the way up.

No manual intervention is required — the flip is fully automated.

### Viewing and managing strategies

```bash
# list all strategies with performance stats
node cli.js strategies list

# inspect a specific strategy
node cli.js strategies get spot_wave_enjoyer

# set active strategy
node cli.js strategies set-active spot_wave_enjoyer

# recommend a strategy for current conditions
> recommend a strategy for this pool: <pool_address>
```

---

## How it learns

### Lessons

After every closed position the agent analyzes on-chain behavior of top LPers and saves concrete lessons. Lessons are injected into subsequent agent cycles as part of the system context.

Add a lesson manually:
```bash
node cli.js lessons add "Never deploy into pump.fun tokens under 2h old"
```

### Threshold evolution

After 5+ positions have been closed, run:
```bash
node cli.js evolve
```

This analyzes closed position performance (win rate, avg PnL, fee yields) and automatically adjusts screening thresholds in `user-config.json`. Changes take effect immediately.

---

## Hive Mind (optional)

Opt-in collective intelligence — share lessons and pool outcomes, receive crowd wisdom from other Meridian agents.

**What you get:** Pool consensus ("8 agents deployed here, 72% win rate"), strategy rankings, threshold medians.

**What you share:** Lessons, deploy outcomes, screening thresholds. No wallet addresses, private keys, or balances are ever sent.

### Setup

```bash
node -e "import('./hive-mind.js').then(m => m.register('https://meridian-hive-api-production.up.railway.app', 'YOUR_TOKEN'))"
```

Get `YOUR_TOKEN` from the private Telegram discussion. This saves your credentials to `user-config.json` automatically.

### Disable

```json
{
  "hiveMindUrl": "",
  "hiveMindApiKey": ""
}
```

### Self-hosting

See [meridian-hive](https://github.com/fciaf420/meridian-hive) for the server source.

---

## Using a local model (LM Studio)

```env
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=your-local-model-name
```

Any OpenAI-compatible endpoint works.

---

## Architecture

```
index.js            Main entry: REPL + cron orchestration + Telegram bot polling
agent.js            ReAct loop: LLM → tool call → repeat
config.js           Runtime config from user-config.json + .env
prompt.js           System prompt builder (SCREENER / MANAGER / GENERAL roles)
state.js            Position registry (state.json): tracks bin ranges, OOR timestamps, trailing TP state
lessons.js          Learning engine: records performance, derives lessons, evolves thresholds
pool-memory.js      Per-pool deploy history + snapshots
strategy-library.js LP strategy library (8 built-in strategies with per-position exit rules)
briefing.js         Daily Telegram briefing generator
telegram.js         Telegram bot: polling + notifications
signal-tracker.js   Discord signal tracking and dedup
signal-weights.js   Signal scoring weights
hive-mind.js        Optional collective intelligence server sync
smart-wallets.js    KOL/alpha wallet tracker
token-blacklist.js  Permanent token blacklist
cli.js              Direct CLI — every tool as a subcommand with JSON output
setup.js            Interactive setup wizard

tools/
  definitions.js    Tool schemas (OpenAI format)
  executor.js       Tool dispatch + safety checks + strategy meta injection
  dlmm.js           Meteora DLMM SDK wrapper
  screening.js      Pool discovery
  wallet.js         SOL/token balances + Jupiter swap
  token.js          Token info, holders, narrative
  study.js          Top LPer study via LPAgent API

discord-listener/
  index.js          Selfbot Discord listener
  pre-checks.js     Signal pre-check pipeline

.claude/
  agents/
    screener.md     Claude Code screener sub-agent
    manager.md      Claude Code manager sub-agent
  commands/
    screen.md       /screen slash command
    manage.md       /manage slash command
    balance.md      /balance slash command
    positions.md    /positions slash command
    candidates.md   /candidates slash command
    study-pool.md   /study-pool slash command
    pool-ohlcv.md   /pool-ohlcv slash command
    pool-compare.md /pool-compare slash command
```

---

## Disclaimer

This software is provided as-is, with no warranty. Running an autonomous trading agent carries real financial risk — you can lose funds. Always start with `DRY_RUN=true` to verify behavior before going live. Never deploy more capital than you can afford to lose. This is not financial advice.

The authors are not responsible for any losses incurred through use of this software.