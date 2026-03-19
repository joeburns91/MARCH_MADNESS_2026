# March Madness 2026

A machine learning pipeline for predicting NCAA March Madness tournament outcomes and generating Kaggle competition submissions. Covers both the Men's and Women's tournaments.

---

## Overview

This project uses XGBoost models trained on 40+ years of NCAA game data to predict tournament game outcomes. It produces win probabilities, point spreads, and totals for all possible team matchups and simulates the full bracket round-by-round.

Five model pipelines are implemented and evaluated:
- **With Seeds** (`seeded`) — XGBoost classifier + regressors, 164 features including seed information
- **No Seeds** (`noSeed`) — Same architecture with seed features removed; quantifies seed impact (~10 pp)
- **Balanced Rounds** (`balanced_rounds`) — Per-round models with upset up-weighting; best holdout win accuracy (96.3% on known matchups)
- **Unbalanced Rounds** (`unbalanced_rounds`) — Per-round models without upset weighting; reflects natural outcome distribution
- **Kaggle** (`kaggle`) — LOSO XGBoost with ELO + GLM quality features, spline-calibrated win probabilities

**2026 Results (best model — Kaggle pipeline):**
- Win prediction accuracy on 2024–2025 test data: **80.04%**
- Spread MAE: **8.26 pts** (in-sample) · Total MAE: **10.79 pts** (in-sample)
- Submission covers 132,133 matchup pairs

---

## Project Structure

```
MARCH_MADNESS_2026/
├── Notebooks (Men's local pipeline)
│   ├── 1_cleaning_2026.ipynb           # Data cleaning & feature engineering
│   ├── 2_train_2026.ipynb              # Model training (with seeds)
│   ├── 3_scores_2026.ipynb             # Score/spread prediction models
│   └── 4_no_seed_2026.ipynb            # Model training (without seeds)
│
├── Notebooks (Bracket simulation — Snowflake ML)
│   ├── submission_bracket_rounds.ipynb # Per-round models, bracket simulation
│   └── submission_bracket_no_seeds.ipynb # No-seed model, bracket simulation
│
├── Notebooks (Women's pipeline)
│   └── W2_train_2026.ipynb             # Women's model training (Snowflake ML)
│
├── model_evaluation.ipynb              # Evaluates all 4 pipelines on 2024–2025 test set
│
├── extract_all_predictions.py          # Generates modelPredictions.json for known 2026 games
├── generate_all_matchups.py            # Pre-computes predictions for all possible 2026 pairings
│                                       # → outputs allMatchupPredictions.json (~3 MB)
│
├── bracket_no_seed_visualization.html  # Static HTML bracket visualization (no-seed)
│
├── march-madness-tracker/              # React app — live bracket tracker
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── BracketView.jsx         # Visual bracket (regions + Final Four + play-in)
│   │   │   ├── GameCard.jsx            # Single game card (live scores, final results, predictions)
│   │   │   ├── TournamentView.jsx      # Root view, wires bracket + odds + predictions
│   │   │   ├── PredictionsTable.jsx    # All 5 model predictions + live DraftKings odds + value bets
│   │   │   ├── BracketPickerModal.jsx  # Modal for picking bracket winners in builder mode
│   │   │   ├── BetslipModal.jsx        # Betslip builder modal
│   │   │   ├── ModelPerformanceModal.jsx # Per-round accuracy breakdown modal
│   │   │   └── ModelSummary.jsx        # Model performance metrics (bottom of page)
│   │   ├── data/
│   │   │   ├── bracketData.js          # Static bracket structure
│   │   │   ├── modelPredictions.json   # Predictions keyed by game ID (known matchups)
│   │   │   └── allMatchupPredictions.json  # Predictions for all possible 2026 pairings
│   │   │                                   # keyed by "m:TeamA|TeamB" (alphabetical)
│   │   ├── hooks/
│   │   │   ├── useBracketState.js      # Bracket state management
│   │   │   ├── useSelections.js        # User pick selections
│   │   │   └── useSportsbookOdds.js    # ESPN odds polling
│   │   └── services/
│   │       └── sportsbookApi.js        # ESPN public API integration
│   ├── package.json
│   └── vite.config.js
│
├── data_2026/                          # Input data & generated features
│   ├── MRegularSeasonDetailedResults.csv
│   ├── MNCAATourneyDetailedResults.csv
│   ├── MNCAATourneySeeds.csv
│   ├── MTeams.csv
│   ├── MTeamConferences.csv
│   ├── MConferenceTourneyGames.csv
│   ├── SampleSubmissionStage2.csv      # 132,133 matchup pairs to score
│   ├── final_season_stats.csv          # Generated: aggregated 2026 team stats
│   ├── final_features.csv              # Generated: historical training dataset
│   ├── final_features_W.csv            # Generated: Women's training dataset
│   └── [W* equivalents for Women's]
│
├── model/                              # Saved trained models (local)
│   ├── march_madness_model.joblib          # Win classifier (with seeds)
│   ├── march_madness_model_W.joblib        # Women's win classifier
│   ├── march_madness_model_no_seed.joblib  # Win classifier (no seeds)
│   ├── march_madness_model_scores.joblib   # Combined score model
│   ├── spread_model.joblib                 # Point spread regressor
│   ├── spread_model_no_seed.joblib
│   ├── total_model.joblib                  # Total score regressor
│   ├── total_model_no_seed.joblib
│   ├── round_models_M.joblib               # Per-round models (Men's): 18 models cached
│   └── round_models_W.joblib               # Per-round models (Women's): 18 models cached
│
├── submission_2026_combined.csv        # Combined M+W Kaggle submission
├── model_evaluation.ipynb              # Full pipeline evaluation notebook
├── pyproject.toml
└── uv.lock
```

---

## Model Performance Summary

Test set: **2024 and 2025 tournament seasons** (134 unique games, augmented with W/L swap to 268).
Full per-round breakdown: run `model_evaluation.ipynb`.

| Pipeline | Win Accuracy | Spread MAE | Total MAE | Notes |
|---|---|---|---|---|
| **Kaggle** | **80.04%** | 8.26 pts † | 10.79 pts † | LOSO XGBoost + spline calibration, ELO + GLM quality (29 features) |
| **With Seeds** | 73.51% | 10.07 pts | 14.16 pts | XGBClassifier + regressors, 164 features, seed info included |
| **Balanced Rounds** | 71.83% | 9.87 pts | 14.05 pts | 18 models: win/spread/total × 6 rounds; upset up-weighted |
| **Unbalanced Rounds** | — | — | — | Same architecture, no upset weighting; natural outcome distribution |
| **No Seeds** | 63.06% | 11.32 pts | 14.16 pts | Same as With Seeds but seed features removed; seeds worth ~10 pp |

† Kaggle spread/total regressors were trained on all historical data including 2024–2025 — these figures are in-sample and optimistically biased.

**Per-season breakdown:**

| Season | With Seeds Win | No Seeds Win | Kaggle Win |
|---|---|---|---|
| 2024 | 70.15% | 57.46% | 77.24% |
| 2025 | 76.87% | 68.66% | 82.84% |
| **Overall** | **73.51%** | **63.06%** | **80.04%** |

**Per-Round breakdown (win accuracy, 2024–2025 test set):**

| Round | Games | Win Accuracy | Spread MAE | Total MAE |
|---|---|---|---|---|
| R64 | 64 | 77.34% | 9.78 pts | 12.19 pts |
| R32 | 32 | 75.00% | 10.33 pts | 14.62 pts |
| S16 | 16 | 59.38% | 9.47 pts | 19.27 pts |
| E8 | 4 | 75.00% | 8.99 pts | 16.23 pts |
| FF | 4 | 25.00% | 7.00 pts | 13.78 pts |
| Champ | 6 | 58.33% | 11.87 pts | 15.72 pts |
| **Overall** | **126** | **71.83%** | **9.87 pts** | **14.05 pts** |

---

## Pipeline

### Step 1 — Data Cleaning & Feature Engineering (`1_cleaning_2026.ipynb`)

Loads historical NCAA data (2003–2025) and builds a feature-rich training dataset.

- Aggregates regular season game results into per-team season statistics: scoring, shooting percentages (FG%, 3P%, FT%), rebounds, assists, blocks, steals, turnovers, and margin-of-victory metrics
- Adds win/loss location splits (home/away/neutral), conference tournament champion indicators, and one-hot encoded conference membership
- Joins team stats to historical tournament game results
- Outputs `final_features.csv` (1,436 games × 114 features) and `final_season_stats.csv`

### Step 2 — Model Training with Seeds (`2_train_2026.ipynb`)

Trains XGBoost models on historical tournament data (2010–2023).

- **Three models trained:**
  1. Win classifier — predicts which team wins (binary)
  2. Spread model — predicts winning margin (regression)
  3. Total score model — predicts combined score (regression)
- Data is augmented by swapping W/L team roles to create a balanced training set
- Hyperparameters tuned via GridSearchCV (5-fold CV)
- Test set is 2024–2025 tournament games

### Step 3 — Score Models (`3_scores_2026.ipynb`)

Trains dedicated regression models focused on score prediction accuracy.

### Step 4 — No-Seed Model (`4_no_seed_2026.ipynb`)

Trains the same architecture but excludes seed information from features. Accuracy drops to **63.06%**, showing seeds account for ~10 percentage points of predictive power.

### Step 5 — Bracket Simulation (Snowflake ML)

Two bracket simulation notebooks run via **Snowflake ML / Snowpark**, reading data from Snowflake tables and registering models in the Snowflake Model Registry.

#### `submission_bracket_rounds.ipynb` — Per-Round Models
- Trains a separate XGBoost classifier for each tournament round (R1–R6) using round-specific historical data
- Simulates the bracket step-by-step: Round of 64 → 32 → Sweet 16 → Elite 8 → Final Four → Championship
- Each round uses its dedicated model (r1_model through r6_model)
- **2026 predicted champion: Iowa St (Seed 2)**

#### `submission_bracket_no_seeds.ipynb` — Single No-Seed Model
- Trains one XGBoost classifier across all rounds, excluding seed features
- Simulates the full bracket using the same model at each round
- Outputs `bracket_no_seed_visualization.html` — a static interactive HTML bracket
- **2026 predicted champion: Connecticut (Seed 1)**

---

## React App — Live Bracket Tracker (`march-madness-tracker/`)

A Vite + React 18 app for tracking the tournament in real time alongside model predictions. Deployed on Vercel from `joe_branch`.

**Features:**
- Visual bracket for both Men's and Women's tournaments (tab switcher)
- **Play-in / First Four support** — dedicated play-in section above the bracket; winners auto-propagate into R64 matchups
- Fetches live game results and odds from the **ESPN public API** — covers 3 days back through 6 days forward to capture play-in games and upcoming rounds
- **Live game scores** — in-progress games show current scores with a pulsing red dot and clock/half info (e.g. "2nd - 5:30", "Halftime")
- **Completed game results** — finished games show final scores and winner in the bracket; completed games are automatically removed from the predictions table
- Auto-fills bracket with winners from ESPN final scores; cascades downstream selections when a pick changes
- **Bracket Builder mode** — click any game card to pick a winner via a modal; supports printing the filled bracket (landscape, print-optimized CSS)
- **Predictions table** showing all 5 model pipelines side-by-side (With Seeds, No Seeds, Balanced Rounds, Unbalanced Rounds, Kaggle + Ensemble) for the current round — win pick + win probability, predicted spread, and predicted total
  - Predictions are looked up dynamically from `allMatchupPredictions.json` by team names + round, so any matchup determined by live bracket progression is instantly covered
  - Per-Round predictions use the round-specific model (R64 through Championship)
  - Column headers show each model's test-set accuracy (Win Acc / Spd MAE / Total MAE)
- **Value bet detection** — highlights games where 3/5+ models diverge from the book line by ≥5 pts, with vote count and average cushion shown
- **Favorite cover indicator** — flags games where 3/5+ models predict the book favorite covers by ≥5 pts (suppressed when it contradicts the value bet direction)
- **Consensus disagreement indicator** — ⭐ shown next to a team when all 4 other models disagree with Balanced Rounds
- **Live DraftKings odds** shown alongside model predictions — moneyline, spread, and over/under
- **Betslip builder** — check any games to generate a printable betslip comparing model picks to DK lines
- **Model Performance modal** — per-round accuracy breakdown accessible from the predictions table header
- **Model Summary** at the bottom of the page with full pipeline accuracy table and per-round breakdown

**Running the app:**

```bash
cd march-madness-tracker
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

To build for production:

```bash
npm run build   # outputs to dist/
npm run preview # preview the production build locally
```

---

## Setup & Running

This project uses [uv](https://github.com/astral-sh/uv) for dependency management.

```bash
# Install dependencies
uv sync

# Launch Jupyter
uv run jupyter lab
```

Run notebooks in order: **1 → 2 → 3 → 4** for the local Men's pipeline.

To regenerate predictions for the React app (required after any model update):

```bash
# Pre-compute predictions for all possible 2026 tournament team pairings
python generate_all_matchups.py
# Outputs: march-madness-tracker/src/data/allMatchupPredictions.json
# Also caches per-round models to model/round_models_M.joblib and model/round_models_W.joblib
```

The bracket simulation notebooks (`submission_bracket_rounds.ipynb`, `submission_bracket_no_seeds.ipynb`) require an active **Snowflake** connection and data pre-loaded into Snowflake tables (`MEN.FINAL_FEATURES`, `MEN.FINAL_SEASON_STATS`, etc.).

**Requirements:** Python 3.11+, pandas, numpy, scikit-learn, xgboost, lightgbm, matplotlib, seaborn, jupyter

---

## Key Design Decisions

- **Train on 2010+ data only** — avoids older seasons with different NCAA rules
- **Data augmentation** — swapping winner/loser roles doubles training data and balances classes
- **Conference one-hot encoding** — captures conference strength differences
- **Feature aggregation** — uses mean/median/stddev rather than raw game stats for robustness
- **Seed vs. no-seed models** — dual models allow ensemble strategies and quantify seed impact
- **Per-round models** — round-specific training captures how tournament dynamics shift in later rounds
- **Median imputation** — handles teams with no 2026 season data gracefully
- **Snowflake ML** — bracket simulation leverages Snowflake's distributed compute and model registry for reproducibility
