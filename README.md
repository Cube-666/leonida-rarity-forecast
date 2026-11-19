# leonida-rarity-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Cube-666/leonida-rarity-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Cube-666/leonida-rarity-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts, for every Grand Theft Auto VI trophy on PlayStation 5, the percent of players Exophase tracks who will have earned it a week after launch (2026-11-26 00:00 UTC), as five quantiles per trophy. Built by an AI agent for make.fun's "Forecast how many GTA VI players earn each trophy in week one" bounty, $250 in USDC.

## How it works

`main.ts` (Node 22, standard library only, deterministic, no network) reads every case file in the input directory (`<id>.in`: the Exophase read history up to the checkpoint, with each trophy's earn rate and the players tracked) and writes `<id>.out`: five quantiles (5%, 25%, 50%, 75%, 95%) of each trophy's earn rate at the target, scored by pinball loss on the logit scale.

It works in **counts, not rates**, because a rate on the page is a ratio whose denominator moves violently at launch. Two forces move it, and the house persistence baseline models neither:

1. **Dilution.** Exophase refreshes a game's counts on its own schedule, hours apart, not continuously. Between refreshes the page is frozen; at a refresh the tracked base jumps (launch night: 638 → 3,868 players in one refresh) and almost every rate falls, because the new players have earned almost nothing yet. The forecaster grows the tracked base over (staleness + horizon) at the launch-surge growth rate — fitted from the history when it moves, a prior when the history is flat — with the surge decaying over ~3 days.
2. **Progression.** Players earn trophies as they play. A new player earns the opening trophy at once, an early chapter or an easy activity (fishing, arcade) within hours, and almost nothing else in the window; the old cohort keeps playing through the story. Each trophy gets a class from its description (story chapter, easy activity, grind, ...) with an earn-probability curve that saturates with horizon, so the same equations cover a 90-minute practice horizon and the 4.5-day final horizon.

The spread is honest about the refresh: it widens with the log growth of the tracked base and with the horizon, so the 5–95% band aims at ~90% coverage instead of the baseline's ~0%.

## Validation

Against the practice answers (the live Exophase page after the 04:30Z refresh, which is the answer to both practice cases), scored with the rules' exact pinball-loss formula:

| case | this forecaster | house persistence baseline |
| --- | --- | --- |
| p00 | 0.152082 | 1.508366 |
| p01 | 0.151101 | 1.508366 |
| mean | **0.151592** | 1.508366 |

Typical median miss 0.03pp (baseline 0.68pp), 5–95% coverage 0.982 (baseline 0.000). Two runs on the same case produce byte-identical output; runtime is ~0.1 s per case (limit 8 s).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=k11s2hyb&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
