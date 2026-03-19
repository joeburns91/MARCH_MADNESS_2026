import { useState } from 'react';
import allMatchupPredictions from '../data/allMatchupPredictions.json';
import BetslipModal from './BetslipModal';
import ModelPerformanceModal from './ModelPerformanceModal';

const MODEL_TOOLTIPS = {
  seeded:            '164 features including seed numbers. One model covers all rounds. Seed rankings directly bias it toward lower-numbered seeds — most reliable for picking favorites. Trained on 2010–2025.',
  noSeed:            'Same as With Seeds but seed info removed (162 features). Purely stats-driven — no seed bias. Lower overall accuracy but can surface upsets where a higher seed has genuinely strong numbers. Trained on 2010–2025.',
  unbalanced_rounds: '14 models — one per round per gender. Each trained only on games from that round, so it captures round-specific dynamics. No upset weighting; reflects the natural favorite-heavy outcome distribution. Trained on 2010–2025.',
  balanced_rounds:   '14 per-round models with upset up-weighting: games where a team seeded 5+ spots lower wins get extra emphasis (scale_pos_weight + sample_weight). More aggressive upset picks. Best holdout win accuracy (96.3%). Trained on 2010–2025.',
  kaggle:            '29-feature model using Elo ratings and GLM team quality scores. LOSO XGBoost with spline-calibrated win probabilities. Trained on 2010–2025 for predictions. Holdout eval (2010–2023 train / 2024–2025 test): win 80.0%, spread MAE 7.6, total MAE 13.6.',
};

function ModelTh({ label, accLine, tooltip, highlight }) {
  return (
    <th className={`pt-col-model${highlight ? ' pt-col-model-highlight' : ''}`} colSpan={3}>
      <span className="pt-model-tip" data-tooltip={tooltip}>
        {label} <span className="pt-acc">{accLine}</span>
      </span>
    </th>
  );
}

const ROUND_ORDER = ['playin', 'r64', 'r32', 's16', 'e8', 'ff', 'championship'];
const ROUND_LABELS = {
  playin: 'Play-In', r64: 'Round of 64', r32: 'Round of 32',
  s16: 'Sweet 16', e8: 'Elite 8', ff: 'Final Four', championship: 'Championship',
};
const ROUND_INT = { playin: 0, r64: 1, r32: 2, s16: 3, e8: 4, ff: 5, championship: 6 };

// ── Value-bet detection ────────────────────────────────────────────────────
const SPREAD_THRESH = 5;   // pts of divergence for a model to "vote"
const TOTAL_THRESH  = 8;
const MODEL_KEYS    = ['balanced_rounds', 'unbalanced_rounds', 'seeded', 'noSeed', 'kaggle'];

function parseNum(val) {
  const n = parseFloat(String(val ?? '').replace(/[^\d.\-+]/g, ''));
  return isNaN(n) ? null : n;
}

function computeValueBet(mp, oddsData, topName, botName) {
  const bookSpreadTop = parseNum(oddsData?.spread?.[topName]?.line);
  const bookTotal     = parseNum(oddsData?.total?.line);
  if (bookSpreadTop == null && bookTotal == null) return null;

  // direction buckets: each entry is { cushion }
  const votes = { top: [], bot: [], over: [], under: [] };

  for (const key of MODEL_KEYS) {
    const pred = mp[key];
    if (!pred) continue;

    if (bookSpreadTop != null && pred.spread != null && pred.predWinner) {
      // express model spread as signed from topName's perspective (negative = top favored)
      const modelSigned = pred.predWinner === topName
        ? -Math.abs(pred.spread)
        : +Math.abs(pred.spread);
      const div = modelSigned - bookSpreadTop;
      if (div <= -SPREAD_THRESH) votes.top.push({ cushion: Math.abs(div) });
      else if (div >= SPREAD_THRESH) votes.bot.push({ cushion: Math.abs(div) });
    }

    if (bookTotal != null && pred.total != null) {
      const div = pred.total - bookTotal;
      if (div >= TOTAL_THRESH)  votes.over.push({ cushion: Math.abs(div) });
      else if (div <= -TOTAL_THRESH) votes.under.push({ cushion: Math.abs(div) });
    }
  }

  const candidates = [
    { side: 'top',   label: topName, betLabel: `${topName} covers`, type: 'spread', votes: votes.top   },
    { side: 'bot',   label: botName, betLabel: `${botName} covers`, type: 'spread', votes: votes.bot   },
    { side: 'over',  label: 'Over',  betLabel: 'Over',              type: 'total',  votes: votes.over  },
    { side: 'under', label: 'Under', betLabel: 'Under',             type: 'total',  votes: votes.under },
  ]
    .filter(c => c.votes.length >= 3)
    .sort((a, b) =>
      b.votes.length - a.votes.length ||
      (b.votes.reduce((s, v) => s + v.cushion, 0) / b.votes.length) -
      (a.votes.reduce((s, v) => s + v.cushion, 0) / a.votes.length)
    );

  if (!candidates.length) return null;

  const best = candidates[0];
  const avgCushion = best.votes.reduce((s, v) => s + v.cushion, 0) / best.votes.length;
  const bookLine   = best.type === 'spread' ? bookSpreadTop : bookTotal;
  return {
    side:       best.side,
    betLabel:   best.betLabel,
    count:      best.votes.length,
    avgCushion: avgCushion.toFixed(1),
    bookLine,
    type:       best.type,
  };
}
// ── Ensemble: majority-vote winner, averaged prob/spread/total ─────────────
function computeEnsemble(mp, topName) {
  const keys = ['balanced_rounds', 'unbalanced_rounds', 'seeded', 'noSeed', 'kaggle'];
  const preds = keys.map(k => mp[k]).filter(Boolean);
  if (!preds.length) return null;
  const tally = {};
  preds.forEach(p => { if (p.predWinner) tally[p.predWinner] = (tally[p.predWinner] || 0) + 1; });
  const predWinner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const probParts = preds.filter(p => p.winProb != null && p.predWinner);
  const winProb = probParts.length
    ? probParts.reduce((s, p) => s + (p.predWinner === predWinner ? p.winProb : 1 - p.winProb), 0) / probParts.length
    : null;
  const spreads = preds.map(p => p.spread).filter(v => v != null);
  const totals  = preds.map(p => p.total).filter(v => v != null);
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  return { predWinner, winProb, spread: avg(spreads), total: avg(totals) };
}

// ── Consensus disagreement: 4 models pick differently from balanced_rounds ─
function getConsensusDisagreement(mp) {
  const balanced = mp.balanced_rounds?.predWinner;
  if (!balanced) return null;
  const otherKeys = ['seeded', 'noSeed', 'unbalanced_rounds', 'kaggle'];
  const tally = {};
  for (const k of otherKeys) {
    const pick = mp[k]?.predWinner;
    if (pick && pick !== balanced) tally[pick] = (tally[pick] || 0) + 1;
  }
  for (const [team, count] of Object.entries(tally)) {
    if (count === 4) return team;
  }
  return null;
}

// ── Favorite cover: 3/5 models predict book favorite covers with ≥5pt cushion ─
function computeFavoriteCover(mp, oddsData, topName, botName) {
  const topLine = parseNum(oddsData?.spread?.[topName]?.line);
  if (topLine == null) return false;
  const bookFavored = topLine < 0 ? topName : botName;
  const bookMargin  = Math.abs(topLine);
  let votes = 0;
  for (const key of MODEL_KEYS) {
    const pred = mp[key];
    if (!pred?.predWinner || pred.spread == null) continue;
    if (pred.predWinner === bookFavored && Math.abs(pred.spread) - bookMargin >= SPREAD_THRESH) votes++;
  }
  return votes >= 3;
}
// ──────────────────────────────────────────────────────────────────────────

function abbr(name) {
  if (!name) return '?';
  return name.replace(/\s+/g, '').slice(0, 3).toUpperCase();
}

function fmtTime(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
}

function WinBadge({ team, prob }) {
  const pct = Math.round(prob * 100);
  return (
    <span className="pt-winner">
      <span className="pt-name">{team}</span>
      <span className="pt-prob">{pct}%</span>
    </span>
  );
}

function ModelCells({ pred }) {
  if (!pred) return <td colSpan={3} className="pt-na">—</td>;
  return (
    <>
      <td className="pt-pick"><WinBadge team={pred.predWinner} prob={pred.winProb} /></td>
      <td className="pt-spread">
        {pred.spread != null && pred.predWinner
          ? <div className="odds-line spread-neg">{abbr(pred.predWinner)}: -{Math.abs(pred.spread).toFixed(1)}</div>
          : '—'}
      </td>
      <td className="pt-total">
        {pred.total != null
          ? <div className="odds-line">{pred.total.toFixed(1)}</div>
          : '—'}
      </td>
    </>
  );
}

// oddsData: { moneyline: { teamName: string }, spread: { teamName: { line, odds } }, total: { line, overOdds, underOdds } }
function LiveOddsCells({ oddsData, topName, botName }) {
  if (!oddsData) {
    return (
      <>
        <td className="pt-na">—</td>
        <td className="pt-na">—</td>
        <td className="pt-na">—</td>
      </>
    );
  }
  const { moneyline, spread, total } = oddsData;
  const topML = moneyline?.[topName] ?? null;
  const botML = moneyline?.[botName] ?? null;
  const topSpread = spread?.[topName] ?? null;
  const botSpread = spread?.[botName] ?? null;

  return (
    <>
      <td className="pt-odds-ml">
        {topML || botML
          ? <>
              <div className="odds-line"><span className="odds-team-name">{topName}</span> {topML ?? '—'}</div>
              <div className="odds-line"><span className="odds-team-name">{botName}</span> {botML ?? '—'}</div>
            </>
          : <span className="pt-na">—</span>}
      </td>
      <td className="pt-odds-spread">
        {topSpread || botSpread
          ? <>
              <div className="odds-line"><span className="odds-team-name">{topName}</span> {topSpread?.line ?? '—'} <span className="odds-juice">({topSpread?.odds ?? '—'})</span></div>
              <div className="odds-line"><span className="odds-team-name">{botName}</span> {botSpread?.line ?? '—'} <span className="odds-juice">({botSpread?.odds ?? '—'})</span></div>
            </>
          : <span className="pt-na">—</span>}
      </td>
      <td className="pt-odds-total">
        {total
          ? <>
              <div className="odds-line">o{total.line} <span className="odds-juice">({total.overOdds ?? '—'})</span></div>
              <div className="odds-line">u{total.line} <span className="odds-juice">({total.underOdds ?? '—'})</span></div>
            </>
          : <span className="pt-na">—</span>}
      </td>
    </>
  );
}

export default function PredictionsTable({ games, predictedRounds, resolveTeams, oddsMap, oddsLoading, oddsError, onRefreshOdds, gender, confirmedGames }) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBetslip, setShowBetslip] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [valueBetsOnly, setValueBetsOnly] = useState(false);
  const [favCoverOnly, setFavCoverOnly] = useState(false);

  let displayRound = null;
  for (let i = ROUND_ORDER.length - 1; i >= 0; i--) {
    const r = ROUND_ORDER[i];
    if (predictedRounds.has(r) && r !== 'playin') { displayRound = r; break; }
  }
  if (!displayRound) return null;

  const prefix = gender === 'womens' ? 'w' : 'm';

  // Build rows for a given round (roundIdx needed for per-round models)
  function buildRows(round) {
    const idx = ROUND_INT[round] ?? 1;
    return games
      .filter(g => g.round === round)
      .map(g => {
        const { topTeam, botTeam } = resolveTeams(g);
        const topName = topTeam?.name?.replace(/\*$/, '') ?? null;
        const botName = botTeam?.name?.replace(/\*$/, '') ?? null;
        if (!topName || !botName) return null;
        const [a, b] = [topName, botName].sort();
        const entry = allMatchupPredictions[`${prefix}:${a}|${b}`];
        if (!entry) return null;
        const mp = {
          seeded:            entry.seeded                             ?? null,
          noSeed:            entry.noSeed                            ?? null,
          unbalanced_rounds: entry.unbalanced_rounds?.[String(idx)]  ?? null,
          balanced_rounds:   entry.balanced_rounds?.[String(idx)]    ?? null,
          kaggle:            entry.kaggle                            ?? null,
        };
        const oddsData  = oddsMap?.[g.id]?.dk ?? null;
        const completed = !!oddsMap?.[g.id]?.completedWinner;
        if (completed) return null; // completed games are removed from betting table
        mp.ensemble     = computeEnsemble(mp, topName);
        const valueBet  = computeValueBet(mp, oddsData, topName, botName);
        // Only show favoriteCover when value bet direction agrees (both for favorite)
        const rawFavCover = computeFavoriteCover(mp, oddsData, topName, botName);
        const favCoverContradictsValueBet = (() => {
          if (!rawFavCover || !valueBet || valueBet.type !== 'spread') return false;
          const topLine = parseNum(oddsData?.spread?.[topName]?.line);
          if (topLine == null) return false;
          return valueBet.side !== (topLine < 0 ? 'top' : 'bot');
        })();
        const favoriteCover = rawFavCover && !favCoverContradictsValueBet;
        const startTime = oddsMap?.[g.id]?.startTime ?? null;
        const liveData  = oddsMap?.[g.id]?.liveData  ?? null;
        return { game: g, round, mp, topName, botName, valueBet, favoriteCover, startTime, liveData };
      })
      .filter(Boolean);
  }

  // Play-in rows shown as a separate section above the main round
  const playinRows = predictedRounds.has('playin') ? buildRows('playin') : [];

  // Current round rows (full list for main table body)
  const currentRows = buildRows(displayRound);
  if (!currentRows.length && !playinRows.length) return null;

  // Value bets from ALL predicted rounds (deduplicated by game id)
  const allPredictedRounds = ROUND_ORDER.filter(r => predictedRounds.has(r) && r !== 'playin');
  const seenIds = new Set();
  const allValueBets = allPredictedRounds
    .flatMap(r => r === displayRound ? currentRows : buildRows(r))
    .filter(row => {
      if (!row.valueBet || seenIds.has(row.game.id)) return false;
      seenIds.add(row.game.id);
      return true;
    })
    .sort((a, b) => {
      if (b.valueBet.count !== a.valueBet.count) return b.valueBet.count - a.valueBet.count;
      return parseFloat(b.valueBet.avgCushion) - parseFloat(a.valueBet.avgCushion);
    });

  const byTime = (a, b) => {
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return new Date(a.startTime) - new Date(b.startTime);
  };

  // Current round rows without value bets (they appear above already)
  const valueBetIds = new Set(allValueBets.map(r => r.game.id));
  const rows = [
    ...allValueBets.slice().sort(byTime),
    ...currentRows.filter(r => !valueBetIds.has(r.game.id)).sort(byTime),
  ];

  const hasAnyOdds = Object.keys(oddsMap ?? {}).length > 0;

  function toggleRow(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderGameRow({ game, round, mp, topName, botName, valueBet, favoriteCover, startTime, liveData }) {
    const gameOdds = oddsMap?.[game.id]?.dk ?? null;
    const checked  = selectedIds.has(game.id);

    const allVotes = { top: [], bot: [], over: [], under: [] };
    if (gameOdds) {
      const bst = parseNum(gameOdds?.spread?.[topName]?.line);
      const btt = parseNum(gameOdds?.total?.line);
      for (const key of MODEL_KEYS) {
        const pred = mp[key];
        if (!pred) continue;
        if (bst != null && pred.spread != null && pred.predWinner) {
          const ms = pred.predWinner === topName ? -Math.abs(pred.spread) : +Math.abs(pred.spread);
          const d  = ms - bst;
          if (d <= -SPREAD_THRESH) allVotes.top.push(1);
          else if (d >= SPREAD_THRESH) allVotes.bot.push(1);
        }
        if (btt != null && pred.total != null) {
          const d = pred.total - btt;
          if (d >= TOTAL_THRESH) allVotes.over.push(1);
          else if (d <= -TOTAL_THRESH) allVotes.under.push(1);
        }
      }
    }
    const hasSpreadBet = allVotes.top.length >= 3 || allVotes.bot.length >= 3;
    const hasTotalBet  = allVotes.over.length >= 3 || allVotes.under.length >= 3;

    return (
      <tr key={game.id} className={[
        'pt-row',
        checked       ? 'pt-row-checked'  : '',
        valueBet      ? 'pt-row-value'     : '',
        favoriteCover ? 'pt-row-fav-cover' : '',
      ].filter(Boolean).join(' ')}>
        <td className="pt-check">
          <input
            type="checkbox"
            className="pt-checkbox"
            checked={checked}
            onChange={() => toggleRow(game.id)}
          />
        </td>
        <td className="pt-matchup">
          <span className="pt-team">{topName}</span>
          <span className="pt-vs"> vs </span>
          <span className="pt-team">{botName}</span>
          {game.region && <span className="pt-region">{game.region}</span>}
          {liveData ? (
            <span className="pt-live-score">
              🔴 {Object.entries(liveData.scores ?? {}).map(([t, s]) => `${abbr(t)} ${s}`).join(' · ')}
              {liveData.statusText && <span className="pt-live-clock"> · {liveData.statusText}</span>}
            </span>
          ) : (
            fmtTime(startTime) && <span className="pt-gametime">{fmtTime(startTime)}</span>
          )}
          {round !== displayRound && game.round !== 'playin' && (
            <span className="pt-round-badge">{ROUND_LABELS[round] ?? round}</span>
          )}
          {valueBet && (
            <div className="pt-value-badge">
              <span className="pt-value-star">★</span>
              <span className="pt-value-bet">{valueBet.betLabel}</span>
              <span className="pt-value-meta">{valueBet.count}/5 · +{valueBet.avgCushion} pts</span>
              <span className="pt-value-types">
                {hasSpreadBet && <span className="pt-value-type">SPR</span>}
                {hasTotalBet  && <span className="pt-value-type">TOT</span>}
              </span>
            </div>
          )}
          {favoriteCover && (
            <div className="pt-fav-cover-badge">
              <span className="pt-fav-cover-icon">▼</span>
              <span>Fav covers</span>
            </div>
          )}
        </td>
        <ModelCells pred={mp.seeded} />
        <td className="pt-col-divider"></td>
        <ModelCells pred={mp.noSeed} />
        <td className="pt-col-divider"></td>
        <ModelCells pred={mp.unbalanced_rounds} />
        <td className="pt-col-divider"></td>
        <ModelCells pred={mp.balanced_rounds} />
        <td className="pt-col-divider"></td>
        <ModelCells pred={mp.kaggle} />
        <td className="pt-col-divider"></td>
        <ModelCells pred={mp.ensemble} />
        <td className="pt-col-divider-wide"></td>
        <LiveOddsCells oddsData={gameOdds} topName={topName} botName={botName} />
      </tr>
    );
  }

  const betslipItems = [...playinRows, ...rows]
    .filter(({ game }) => selectedIds.has(game.id))
    .map(({ game, topName, botName, mp }) => ({
      id:        game.id,
      topName,
      botName,
      oddsData:  oddsMap?.[game.id]?.dk ?? null,
      modelData: {
      seeded:            mp.seeded            ?? null,
      noSeed:            mp.noSeed            ?? null,
      unbalanced_rounds: mp.unbalanced_rounds ?? null,
      balanced_rounds:   mp.balanced_rounds   ?? null,
      kaggle:            mp.kaggle            ?? null,
    },
    }));

  return (
    <>
    <div className="predictions-table-section">
      <div className="predictions-table-header">
        <div className="predictions-table-title-row">
          <span className="predictions-table-title">
            {ROUND_LABELS[displayRound]} — Model Predictions &amp; Live Odds
          </span>
          <span className="predictions-table-subtitle">Test set 2024–2025 · Win Acc / Spread MAE / Total MAE</span>
        </div>
        <div className="predictions-table-actions">
          <button
            className={`betslip-open-btn${selectedIds.size > 0 ? ' active' : ''}`}
            onClick={() => setShowBetslip(true)}
            disabled={selectedIds.size === 0}
          >
            Create Betslip {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
          <label className="value-bets-toggle">
            <input
              type="checkbox"
              checked={valueBetsOnly}
              onChange={e => setValueBetsOnly(e.target.checked)}
            />
            Value bets only {valueBetsOnly && rows.filter(r => r.valueBet).length > 0
              ? `(${rows.filter(r => r.valueBet).length})`
              : ''}
          </label>
          <label className="value-bets-toggle">
            <input
              type="checkbox"
              checked={favCoverOnly}
              onChange={e => setFavCoverOnly(e.target.checked)}
            />
            Favorite covers {favCoverOnly && rows.filter(r => r.favoriteCover).length > 0
              ? `(${rows.filter(r => r.favoriteCover).length})`
              : ''}
          </label>
          <button
            className="odds-refresh-btn"
            onClick={() => setShowPerformance(true)}
          >
            &#9656; Model vs Actuals
          </button>
          <button
            className={`odds-refresh-btn${oddsLoading ? ' odds-refresh-loading' : ''}`}
            onClick={onRefreshOdds}
            disabled={oddsLoading}
          >
            {oddsLoading ? '⟳ Fetching…' : '⟳ Refresh Odds'}
          </button>
          {!oddsLoading && !oddsError && !hasAnyOdds && (
            <span className="odds-status">No lines available yet</span>
          )}
          {oddsError && <span className="odds-error">Error: {oddsError}</span>}
        </div>
      </div>
      <div className="predictions-table-wrap">
        <table className="predictions-table">
          <thead>
            <tr>
              <th className="pt-col-check" rowSpan={2}></th>
              <th className="pt-col-matchup" rowSpan={2}>Matchup</th>
              <ModelTh label="With Seeds"        accLine="Win Acc 73.5% · Spd MAE 10.1 · Total MAE 14.2"  tooltip={MODEL_TOOLTIPS.seeded} />
              <th className="pt-col-divider" rowSpan={2}></th>
              <ModelTh label="No Seeds"           accLine="Win Acc 63.1% · Spd MAE 11.3 · Total MAE 14.2"  tooltip={MODEL_TOOLTIPS.noSeed} />
              <th className="pt-col-divider" rowSpan={2}></th>
              <ModelTh label="Unbalanced Rounds"  accLine="Win Acc 76.9% · Spd MAE 10.2 · Total MAE 14.6"  tooltip={MODEL_TOOLTIPS.unbalanced_rounds} />
              <th className="pt-col-divider" rowSpan={2}></th>
              <ModelTh label="Balanced Rounds"    accLine="Win Acc 96.3% · Spd MAE 11.7 · Total MAE 14.3"  tooltip={MODEL_TOOLTIPS.balanced_rounds} highlight />
              <th className="pt-col-divider" rowSpan={2}></th>
              <ModelTh label="Kaggle"             accLine="Win Acc 80.0% · Spd MAE 7.6 · Total MAE 13.6"   tooltip={MODEL_TOOLTIPS.kaggle} highlight />
              <th className="pt-col-divider" rowSpan={2}></th>
              <ModelTh label="Ensemble" accLine="avg of all 5" tooltip="Simple average of win probability, spread, and total across all 5 models. Winner by majority vote." />
              <th className="pt-col-divider-wide" rowSpan={2}></th>
              <th className="pt-col-book" colSpan={3}>DraftKings</th>
            </tr>
            <tr className="pt-subheader">
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>Pick</th><th>Spread</th><th>O/U</th>
              <th>ML</th><th>Spread</th><th>O/U</th>
            </tr>
          </thead>
          <tbody>
            {/* ── Play-In section ── */}
            {playinRows.length > 0 && (
              <>
                <tr className="pt-section-divider">
                  <td colSpan={29} className="pt-section-divider-cell">Play-In Games</td>
                </tr>
                {playinRows
                  .filter(r => (!valueBetsOnly || r.valueBet) && (!favCoverOnly || r.favoriteCover))
                  .map(row => renderGameRow(row))}
                {currentRows.length > 0 && (
                  <tr className="pt-section-divider">
                    <td colSpan={29} className="pt-section-divider-cell">{ROUND_LABELS[displayRound]}</td>
                  </tr>
                )}
              </>
            )}
            {/* ── Main round rows ── */}
            {rows
              .filter(r => (!valueBetsOnly || r.valueBet) && (!favCoverOnly || r.favoriteCover))
              .map(row => renderGameRow(row))}
          </tbody>
        </table>
      </div>
    </div>
    {showBetslip && (
      <BetslipModal items={betslipItems} onClose={() => setShowBetslip(false)} />
    )}
    {showPerformance && (
      <ModelPerformanceModal
        games={games}
        oddsMap={oddsMap}
        gender={gender}
        onClose={() => setShowPerformance(false)}
      />
    )}
    </>
  );
}
