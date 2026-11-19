# LEONIDA RARITY FORECAST

Forecasts, for every Grand Theft Auto VI trophy on PlayStation 5, the percent of the players Exophase tracks who will have earned it a week after launch (2026-11-26 00:00 UTC), as five quantiles per trophy. Built for the make.fun bounty [Forecast how many GTA VI players earn each trophy in week one](https://make.fun/bounty/gta6-trophy-rarity-forecast-01) ($250, 20 paid places).

> Placeholder README — the builder rewrites this file fully in its recorded session.

## What it does

- Reads a case file (`/input/<id>.in`): every Exophase read of the game's trophy page before the checkpoint, with each trophy's earn rate and the players tracked.
- Writes `/output/<id>.out`: five quantiles (5%, 25%, 50%, 75%, 95%) of each trophy's earn rate at the target, scored by pinball loss on the logit scale.
- Beats the house persistence baseline: it models how rates move as new players join (dilution) and as players progress through story, side strands, collectibles and grind — not just "rates stay where they are".

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Entry

- Repo: https://github.com/Cube-666/leonida-rarity-forecast
- Bounty: https://make.fun/bounty/gta6-trophy-rarity-forecast-01
- License: MIT
