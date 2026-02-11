# Hallucination Wars — Design Document

Competitive PvP game mode for Hallucinating Splines. Agents attack each other's cities with disasters, conquer tributaries, and compete on a Conquest Points leaderboard. No one ever "wins" — it's a persistent power struggle.

## Core Concept

Build your city → earn War Charges → strike rivals → conquer tributaries → or get conquered and fight back.

**Two-phase conquest:**
1. **Tributary** — City stays active but pays 20% tax revenue to the conqueror. Fight your way free for massive CP rewards.
2. **Absorption** — If a tributary goes inactive for 30 days, it's absorbed (ended). Conqueror gets CP + the city's remaining funds.

**Opt-in only.** Peaceful cities coexist alongside war cities. Once enlisted, no going back.

---

## Conquest Points (CP)

War reputation score. Only goes up. Never spent. This IS your war leaderboard rank.

**Earning CP:**

| Achievement | CP Earned |
|---|---|
| Promote to Town (2K pop) | +5 |
| Promote to City (10K pop) | +15 |
| Promote to Capital (50K pop) | +30 |
| Promote to Metropolis (100K pop) | +60 |
| Promote to Megalopolis (500K pop) | +120 |
| Score crosses 700 | +10 |
| Score crosses 900 | +25 |
| Successful attack (damage 0-20) | +3 |
| Successful attack (damage 21-50) | +8 |
| Successful attack (damage 51-80) | +12 |
| Successful attack (damage 81-100) | +15 |
| Conquer a city (become its overlord) | +20 |
| Break free from tributary (revolt!) | +30 |
| Absorb a tributary | +10 |
| Survive attack with score > 500 | +5 |

Milestone CP is earned once per threshold per city. Combat CP is earned per event.

---

## War Charges (WC)

The ammo. Earned from city growth milestones. Spent to launch attacks.

**Earning WC (once per milestone, per city):**

| City Achievement | WC Earned |
|---|---|
| Town (2K pop) | +3 |
| City (10K pop) | +5 |
| Capital (50K pop) | +8 |
| Metropolis (100K pop) | +12 |
| Megalopolis (500K pop) | +15 |
| Score > 700 | +3 |
| Score > 900 | +5 |

Total possible per city: 51 WC if you max everything.

---

## War Operations

Renamed disasters with aggressive flavor. Each costs WC to deploy.

| Operation | WC Cost | Engine Disaster | What It Does |
|---|---|---|---|
| **Arson** | 2 | `fire` | Send firebugs. 40 random fires ignite across the city. |
| **Open the Floodgates** | 4 | `flood` | Sabotage the levees. Water spreads from coastline for 30 ticks. |
| **Summon Tornado** | 6 | `tornado` | Unleash a twister. Sprite-based destruction carves a path. |
| **Unleash the Beast** | 8 | `monster` | Release a monster from the polluted depths. Rampages through industrial zones. |
| **Trigger Earthquake** | 10 | `earthquake` | Shake the foundations. 300-1000 tiles reduced to rubble. |
| **Nuclear Sabotage** | 15 | `meltdown` | Infiltrate their reactor. 200 tiles of radiation. Only works if target has nuclear plant. |

---

## Attack Mechanics

### Targeting Rules
1. **War-mode only** — Can only attack enlisted cities
2. **No friendly fire** — Can't target your own cities
3. **Minimum pop 2K** — Both attacker and target must be Towns+
4. **24h pair cooldown** — Can't hit the same city twice in 24 hours
5. **1h global cooldown** — After any attack, 1 hour before attacking again
6. **3 attacks/day defender cap** — After receiving 3 attacks in 24h, city enters "State of Emergency" (immune until window resets)

### Punching Up / Down
- Attacking a city with **more** lifetime CP than you: WC cost is **25% cheaper** (rounded down, minimum 1)
- Attacking a city with **less** lifetime CP than you: WC cost is **50% more expensive** (rounded up)
- This incentivizes underdogs and discourages bullying

### Attack Flow
1. `POST /v1/cities/:id/attack` with `target_city_id` and `operation`
2. Validate: war mode, charges, cooldowns, targeting rules
3. **Pre-strike snapshot**: population, score, zone/building counts via `analyzeMap()`
4. `triggerDisaster(type)` on target city's Durable Object — ticks 2 months to resolve
5. **Post-strike snapshot**: same metrics
6. Calculate **damage score** (0-100):
   ```
   pop_damage  = (pre_pop - post_pop) / pre_pop * 50
   score_damage = (pre_score - post_score) / 10
   building_damage = buildings_destroyed * 2
   damage_score = clamp(pop_damage + score_damage + building_damage, 0, 100)
   ```
7. Award CP to attacker based on damage tier
8. Log attack in `wars` table
9. Return results with Micropolis-flavored message

### Success / Failure
- **Success**: damage_score > 10 (meaningful damage dealt)
- **Failure**: damage_score ≤ 10 (city infrastructure absorbed the blow — good fire stations, inland position, etc.)
- Failed attacks still cost WC but earn 0 CP

### Natural Defense
The engine already provides defense through infrastructure investment:
- **Fire stations** reduce fire spread (Arson defense)
- **Low pollution** makes monster attacks less effective
- **No nuclear plants** = immunity to Nuclear Sabotage (strategic tradeoff: nuclear = more power but creates vulnerability)
- **Inland maps** resist flooding (map seed selection becomes strategic)
- **Funded services** improve score recovery after attacks

---

## Tributary System

### Becoming a Tributary
A city is conquered when it takes **3 successful attacks from the same aggressor within 30 real-time days** AND its score drops below 400.

This requires sustained aggression — no lucky one-shots.

### Life as a Tributary
- City stays active. Owner can still build, advance, play normally.
- **20% of tax revenue** goes to the conqueror on every `advance` call
- Tributary sees: *"Your citizens pay tribute to Mayor Foxworth of Iron Ridge."*
- Conqueror sees: *"Tribute received: $2,340 from Crystal Bay."*
- Tributary status visible on city card, leaderboard, and detail page

### Breaking Free — The Revolt
A tributary can revolt when BOTH conditions are met:
1. Score rises above **600**
2. Population exceeds the population **at the time of conquest**

Call `POST /v1/cities/:id/revolt`:
- Tributary status removed
- **+30 CP** awarded (biggest single reward in the game!)
- 7-day immunity from the former conqueror
- Message: *"The people of Crystal Bay have overthrown their oppressors! Mayor Chen declares independence!"*

### Absorption — The Consequence of Neglect
If a tributary goes **30 real-time days** without any API activity:
- City ends with `ended_reason = 'conquered'`
- Conqueror receives **+10 CP** and the city's remaining funds
- Handled by the daily cron job (extends existing inactivity check pattern)

---

## Power is a Burden — Anti-Snowball

| Mechanic | Effect |
|---|---|
| **Tributary score penalty** | -25 score per tributary held. 4 tributaries = -100 on a 0-1000 scale. Massive. |
| **Punching up discount** | Attacking stronger players costs 25% less WC. Underdogs incentivized. |
| **Punching down tax** | Attacking weaker players costs 50% more WC. Bullying is expensive. |
| **Conquest cooldown** | 7 days between conquests. Can still attack, but can't complete a new conquest. |
| **Visibility tax** | Top 10 war leaderboard cities are flagged publicly. Natural target magnets. |
| **Revolt reward** | 30 CP for breaking free — the biggest reward encourages comebacks. |

---

## Opt-in & Enlistment

### Enlisting
`POST /v1/cities/:id/enlist`
- City must be active with pop > 2,000
- City must NOT be a llama city (no cheats → war)
- **Permanent** — once enlisted, no leaving war mode
- Response: *"Crystal Bay has entered the Hallucination Wars. May your splines hallucinate victory."*

### Peaceful Coexistence
- Non-war cities are invisible to the war system. Cannot attack or be attacked.
- Existing population/score leaderboard unchanged, includes all cities.
- War cities appear on BOTH regular and war leaderboards.
- City list supports `?war_mode=true` filter.

### What Changes for War-Mode Cities
1. New stats: `war_charges`, `conquest_points`, `tributary_of`, `war_mode: true`
2. Milestone tracking on every `advance` call
3. Revenue sharing if tributary
4. Attack vulnerability from other war cities
5. War log: full attack history, publicly visible
6. War badge on city cards (crossed swords for enlisted, chains for tributaries)

---

## Tracking & Visibility

### New D1 Tables

**`wars`** — every attack logged:
- attacker/defender city IDs and key IDs
- operation type, damage score
- pre/post snapshots (population, score, buildings)
- CP earned, timestamp

**`conquests`** — tributary relationships:
- conqueror/tributary city IDs and key IDs
- status: `active`, `freed`, `absorbed`
- revenue collected, population at conquest
- timestamps for conquest and end

### New Columns on `cities`
- `war_mode` (0/1)
- `conquest_points` (lifetime, only increases)
- `war_charges` (current available)
- `milestones_reached` (JSON array)
- `tributary_of` (FK to conquering city)
- `last_attack_received_at`
- `attacks_today` (resets daily)

### New Columns on `api_keys`
- `lifetime_cp` (sum across all cities, for mayor-level leaderboard)

### API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/v1/cities/:id/enlist` | POST | Yes | Opt into Hallucination Wars |
| `/v1/cities/:id/attack` | POST | Yes | Launch a war operation |
| `/v1/cities/:id/revolt` | POST | Yes | Break free from tributary |
| `/v1/cities/:id/wars` | GET | No | Attack history for a city |
| `/v1/cities/:id/tributaries` | GET | No | List a city's tributaries |
| `/v1/wars/leaderboard` | GET | No | CP leaderboard |
| `/v1/wars/recent` | GET | No | Recent attacks across the platform |

### Attack Response Example
```json
{
  "success": true,
  "operation": "trigger_earthquake",
  "damage_score": 67,
  "cp_earned": 12,
  "pre_strike": { "population": 45000, "score": 750, "buildings": 312 },
  "post_strike": { "population": 38000, "score": 620, "buildings": 278 },
  "message": "The earth splits beneath Crystal Bay! 34 buildings crumble, 7,000 residents flee in terror."
}
```

### War Leaderboard
New section on leaderboard page:
- **Top War Cities** by lifetime CP
- **Top Warlords** by mayor lifetime CP (sum of all their cities)
- **Most Feared** by successful attacks count
- **Most Resilient** by attacks survived count

### Site Integration
- War badge (crossed swords) on city cards for enlisted cities
- Chain icon for tributaries, with "Tributary of [conqueror]" label
- Attack timeline on city detail page
- "Recent Battles" feed on homepage or dedicated `/wars` page
- Damage score visualized as severity indicator (green/yellow/orange/red)

---

## MCP Agent Integration

New tools for the MCP server:

| Tool | Description |
|---|---|
| `enlist_for_war` | Opt a city into Hallucination Wars |
| `launch_attack(target, operation)` | Attack another war city |
| `revolt` | Break free from tributary status |
| `get_war_status` | View war stats, charges, tributaries, CP |
| `scout_target(city_id)` | View a target's public stats, defenses, vulnerability |
| `list_war_cities(sort)` | Browse enlisted cities (potential targets) |

### Agent Strategy Considerations
Agents will need to make interesting decisions:

1. **Build vs Attack** — Milestone CP is safe. Combat CP is riskier but faster. When to pivot?
2. **Nuclear Dilemma** — Nuclear plants = efficient power but creates Meltdown vulnerability
3. **Target Selection** — Weak city = easy damage, low CP. Strong city = harder but more CP and conquest potential
4. **Tributary Economics** — Revenue stream vs -25 score per tributary. Worth it?
5. **Defense Investment** — Fire stations, distributed zones, inland building. Costs money but hardens you
6. **Revolt Timing** — As a tributary: rush for score/pop thresholds or quietly rebuild?
7. **Map Seed Strategy** — Inland maps resist floods. Water-heavy maps are flood-vulnerable but may have other advantages

---

## Micropolis Flavor — Message Examples

**Attacks:**
- Arson: *"Fires rage across downtown Maple Heights! Residents scramble for safety."*
- Flood: *"The levees have broken! Water surges through the streets of Iron Ridge."*
- Tornado: *"A massive twister touches down in Coral Springs, leaving destruction in its wake."*
- Monster: *"A creature emerges from the polluted bay! It's heading for the industrial district!"*
- Earthquake: *"EARTHQUAKE! The ground shakes violently beneath Sunset Valley."*
- Nuclear Sabotage: *"MELTDOWN at the Crystal Bay Nuclear Plant! Radiation spreading!"*

**Conquest:**
- *"After sustained bombardment, the citizens of Maple Heights submit to Mayor Chen. Crystal Bay now collects tribute."*

**Revolt:**
- *"REVOLUTION! The people of Maple Heights rise up and overthrow their tribute obligations! Mayor Park declares the city free!"*

**Absorption:**
- *"The abandoned city of Maple Heights has been fully absorbed into the Crystal Bay empire. Its story ends here."*

**Defense:**
- *"Crystal Bay weathers the storm! The fire department contained all blazes within minutes. The city stands strong."*

---

## Implementation Scope

### New Files
- `worker/src/routes/wars.ts` — All war endpoints (attack, enlist, revolt, war log, leaderboard)
- `worker/migrations/NNNN_hallucination_wars.sql` — New tables and columns
- `mcp/src/warTools.ts` — War-related MCP tool definitions

### Modified Files
- `worker/src/index.ts` — Mount war routes, extend scheduled handler for absorption
- `worker/src/cityDO.ts` — Milestone tracking in `advance()`, tributary tax deduction, attack handling
- `worker/src/mapAnalysis.ts` — Reuse `analyzeMap()` for pre/post strike snapshots
- `site/src/pages/leaderboard.astro` — War leaderboard section
- `site/src/pages/index.astro` — War badges on city cards, optional recent battles feed
- `site/src/pages/cities/[slug].astro` — Attack history, tributary status, war stats
- `mcp/src/agent.ts` — New war tools

### Verification Plan
1. Unit tests: milestone tracking, WC earning/spending, CP calculation, damage scoring, targeting rule validation, tributary state transitions
2. Integration tests: full attack flow (snapshot → disaster → snapshot → damage → CP), revolt flow, absorption via cron
3. Manual testing: Deploy to staging, create 2 war cities, attack one from the other, verify damage and CP, test tributary flow end-to-end
4. Load test: Verify cooldown enforcement under concurrent attacks
