import allMatchupPredictions from '../data/allMatchupPredictions.json';

const MODEL_KEYS = [
  { key: 'balanced_rounds',   label: 'Balanced',   perRound: true },
  { key: 'unbalanced_rounds', label: 'Unbalanced', perRound: true },
  { key: 'kaggle',            label: 'Kaggle' },
  { key: 'seeded',            label: 'Seeded' },
  { key: 'noSeed',            label: 'No Seed' },
  { key: 'ensemble',          label: 'Ensemble' },
];

// ── Value-bet detection (matches PredictionsTable logic) ──────
const SPREAD_THRESH = 5;
const TOTAL_THRESH  = 8;
const VB_MODEL_KEYS = ['balanced_rounds', 'unbalanced_rounds', 'seeded', 'noSeed', 'kaggle'];

function parseNum(val) {
  const n = parseFloat(String(val ?? '').replace(/[^\d.\-+]/g, ''));
  return isNaN(n) ? null : n;
}

function computeValueBet(mp, oddsData, topName, botName) {
  const bookSpreadTop = parseNum(oddsData?.spread?.[topName]?.line);
  const bookTotal     = parseNum(oddsData?.total?.line);
  if (bookSpreadTop == null && bookTotal == null) return null;

  const votes = { top: [], bot: [], over: [], under: [] };
  for (const key of VB_MODEL_KEYS) {
    const pred = mp[key];
    if (!pred) continue;
    if (bookSpreadTop != null && pred.spread != null && pred.predWinner) {
      const modelSigned = pred.predWinner === topName ? -Math.abs(pred.spread) : +Math.abs(pred.spread);
      const div = modelSigned - bookSpreadTop;
      if (div <= -SPREAD_THRESH) votes.top.push({ cushion: Math.abs(div) });
      else if (div >= SPREAD_THRESH) votes.bot.push({ cushion: Math.abs(div) });
    }
    if (bookTotal != null && pred.total != null) {
      const div = pred.total - bookTotal;
      if (div >= TOTAL_THRESH)        votes.over.push({ cushion: Math.abs(div) });
      else if (div <= -TOTAL_THRESH)  votes.under.push({ cushion: Math.abs(div) });
    }
  }

  const candidates = [
    { side: 'top',   betLabel: `${topName} covers`, type: 'spread', votes: votes.top   },
    { side: 'bot',   betLabel: `${botName} covers`, type: 'spread', votes: votes.bot   },
    { side: 'over',  betLabel: 'Over',              type: 'total',  votes: votes.over  },
    { side: 'under', betLabel: 'Under',             type: 'total',  votes: votes.under },
  ].filter(c => c.votes.length >= 3)
   .sort((a, b) => b.votes.length - a.votes.length);

  if (!candidates.length) return null;
  const best = candidates[0];
  const avgCushion = best.votes.reduce((s, v) => s + v.cushion, 0) / best.votes.length;
  return { side: best.side, betLabel: best.betLabel, count: best.votes.length, avgCushion: avgCushion.toFixed(1), type: best.type };
}

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

const ROUND_INT = { playin: 0, r64: 1, r32: 2, s16: 3, e8: 4, ff: 5, championship: 6 };
const ROUND_LABELS = {
  playin: 'Play-In', r64: 'R64', r32: 'R32',
  s16: 'S16', e8: 'E8', ff: 'FF', championship: 'Champ',
};

function AccBadge({ pct }) {
  if (pct == null) return <span className="mp-na">—</span>;
  const color = pct >= 75 ? '#3fb950' : pct >= 60 ? '#f59e0b' : '#f85149';
  return <span className="mp-acc-badge" style={{ color }}>{pct.toFixed(1)}%</span>;
}

function abbr(name) {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  return words.length === 1 ? name.slice(0, 6) : words.map(w => w[0]).join('').toUpperCase();
}

export default function ModelPerformanceModal({ games, oddsMap, gender, onClose }) {
  const prefix = gender === 'womens' ? 'w' : 'm';

  const completedGames = games
    .filter(g => oddsMap?.[g.id]?.completedWinner)
    .map(g => {
      const result = oddsMap[g.id];
      const topName = g.topTeam?.name?.replace(/\*$/, '');
      const botName = g.botTeam?.name?.replace(/\*$/, '');
      if (!topName || !botName) return null;

      const [a, b] = [topName, botName].sort();
      const entry = allMatchupPredictions[`${prefix}:${a}|${b}`];
      const roundIdx = ROUND_INT[g.round] ?? 1;

      const mp = {
        seeded:            entry?.seeded                                ?? null,
        noSeed:            entry?.noSeed                               ?? null,
        unbalanced_rounds: entry?.unbalanced_rounds?.[String(roundIdx)] ?? null,
        balanced_rounds:   entry?.balanced_rounds?.[String(roundIdx)]   ?? null,
        kaggle:            entry?.kaggle                               ?? null,
      };
      mp.ensemble = computeEnsemble(mp, topName);

      // Actual margins — from stored values or computed from scores
      let actualSpread = result.actualSpread ?? null;
      let actualTotal  = result.actualTotal  ?? null;
      if ((actualSpread == null || actualTotal == null) && result.scores) {
        const vals = Object.values(result.scores);
        if (vals.length === 2) {
          actualSpread = actualSpread ?? Math.abs(vals[0] - vals[1]);
          actualTotal  = actualTotal  ?? (vals[0] + vals[1]);
        }
      }

      const bookTotal      = parseNum(result.dk?.total?.line);
      const bookSpreadTop  = parseNum(result.dk?.spread?.[topName]?.line);
      const bookSpreadBot  = parseNum(result.dk?.spread?.[botName]?.line);
      const valueBet  = computeValueBet(mp, result.dk ?? {}, topName, botName);

      return {
        topName, botName,
        round:       g.round,
        winner:      result.completedWinner,
        startTime:   result.startTime ?? null,
        actualSpread,
        actualTotal,
        bookTotal,
        bookSpreadTop,
        bookSpreadBot,
        scores:      result.scores ?? null,
        mp,
        valueBet,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (!a.startTime && !b.startTime) return 0;
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      return new Date(a.startTime) - new Date(b.startTime);
    });

  // Debug: log completed games data to help diagnose missing spread/total analysis
  if (completedGames.length > 0) {
    console.log('[ModelPerformanceModal] completedGames:', completedGames.map(g => ({
      matchup: `${g.topName} vs ${g.botName}`,
      winner: g.winner,
      actualSpread: g.actualSpread,
      actualTotal: g.actualTotal,
      bookTotal: g.bookTotal,
      balancedSpread: g.mp.balanced_rounds?.spread,
    })));
  }

  // Per-model aggregate stats
  const stats = MODEL_KEYS.map(({ key, label }) => {
    let wins = 0, losses = 0;
    const spreadErrors = [], totalErrors = [];
    for (const game of completedGames) {
      const pred = game.mp[key];
      if (!pred) continue;
      if (pred.predWinner === game.winner) wins++; else losses++;
      if (pred.spread != null && game.actualSpread != null)
        spreadErrors.push(Math.abs(Math.abs(pred.spread) - game.actualSpread));
      if (pred.total != null && game.actualTotal != null)
        totalErrors.push(Math.abs(pred.total - game.actualTotal));
    }
    const total = wins + losses;
    return {
      label, wins, losses, total,
      winPct:    total > 0 ? (wins / total) * 100 : null,
      spreadMae: spreadErrors.length ? spreadErrors.reduce((s, v) => s + v, 0) / spreadErrors.length : null,
      totalMae:  totalErrors.length  ? totalErrors.reduce((s, v) => s + v, 0)  / totalErrors.length  : null,
    };
  });

  return (
    <div className="mp-overlay" onClick={onClose}>
      <div className="mp-modal" onClick={e => e.stopPropagation()}>

        <div className="mp-modal-header">
          <span className="mp-title">
            Model Performance — 2026 Tournament
            <span className="mp-subtitle"> · {completedGames.length} game{completedGames.length !== 1 ? 's' : ''} completed</span>
          </span>
          <button className="betslip-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="mp-modal-body">
          {completedGames.length === 0 ? (
            <p className="mp-empty">No completed games found yet. Refresh odds to pick up results.</p>
          ) : (
            <>
              {/* Summary table */}
              <div className="mp-table-wrap">
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Record</th>
                      <th>Win %</th>
                      <th>Spread MAE</th>
                      <th>Total MAE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map(s => (
                      <tr key={s.label}>
                        <td className="mp-model-name">{s.label}</td>
                        <td className="mp-wl">{s.total > 0 ? `${s.wins}–${s.losses}` : '—'}</td>
                        <td className="mp-pct"><AccBadge pct={s.winPct} /></td>
                        <td className="mp-mae">{s.spreadMae != null ? `${s.spreadMae.toFixed(2)} pts` : '—'}</td>
                        <td className="mp-mae">{s.totalMae  != null ? `${s.totalMae.toFixed(2)} pts`  : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Game-by-game log */}
              <h3 className="mp-log-title">Game Log</h3>
              <div className="mp-table-wrap">
                <table className="mp-table mp-log-table">
                  <thead>
                    <tr>
                      <th>Rd</th>
                      <th>Matchup</th>
                      <th>Result</th>
                      {MODEL_KEYS.map(m => <th key={m.key}>{m.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {completedGames.map((game, i) => {
                      const scoreStr = game.scores
                        ? Object.entries(game.scores)
                            .sort((a, b) => b[1] - a[1])
                            .map(([name, score]) => `${abbr(name)} ${score}`)
                            .join(' · ')
                        : game.winner;

                      return (
                        <tr key={i} className={game.valueBet ? 'mp-row-vb' : ''}>
                          <td className="mp-round">
                            {ROUND_LABELS[game.round] ?? game.round}
                            {game.startTime && (
                              <div className="mp-game-date">
                                {new Date(game.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                            )}
                          </td>
                          <td className="mp-matchup">
                            {game.topName} vs {game.botName}
                            {game.valueBet && (
                              <span className="mp-vb-badge" title={`${game.valueBet.count}/5 models · +${game.valueBet.avgCushion} pts`}>
                                ★ {game.valueBet.betLabel}
                              </span>
                            )}
                          </td>
                          <td className="mp-actual">
                            <div className="mp-actual-winner">{scoreStr}</div>
                            {game.actualSpread != null && (
                              <div className="mp-actual-lines">
                                Spr: {game.actualSpread.toFixed(1)} · Tot: {game.actualTotal?.toFixed(1) ?? '—'}
                              </div>
                            )}
                          </td>
                          {MODEL_KEYS.map(({ key }) => {
                            const pred = game.mp[key];
                            if (!pred) return <td key={key} className="mp-na">—</td>;
                            const winCorrect = pred.predWinner === game.winner;

                            // Which side does this model's spread imply we should bet?
                            // Model predicts small spread vs big book line → bet the underdog.
                            // Model predicts big spread vs small book line → bet the favorite.
                            // Same logic as computeValueBet: sign model spread from topName's perspective.
                            const spreadBet = (() => {
                              if (pred.spread == null || game.actualSpread == null || game.bookSpreadTop == null) return null;
                              const modelImplied = pred.predWinner === game.topName
                                ? -Math.abs(pred.spread)
                                : +Math.abs(pred.spread);
                              const div = modelImplied - game.bookSpreadTop;
                              // div < 0: model more bullish on topName → bet topName covers
                              // div > 0: model thinks game closer / botName has value → bet botName covers
                              const betTeam = div <= 0 ? game.topName : game.botName;
                              const betLine = div <= 0 ? game.bookSpreadTop : game.bookSpreadBot;
                              if (betLine == null) return null;
                              const betWon = game.winner === betTeam;
                              const actualFromBet = betWon ? game.actualSpread : -game.actualSpread;
                              return { betTeam, betLine, covers: actualFromBet > -betLine };
                            })();

                            // Total bet: compare model total to book total to determine over/under
                            // then check if actual total matched that direction
                            const totalBetResult = (() => {
                              if (pred.total == null || game.actualTotal == null || game.bookTotal == null) return null;
                              const betOver = pred.total > game.bookTotal;
                              const betUnder = pred.total < game.bookTotal;
                              if (!betOver && !betUnder) return null; // model matches book exactly
                              return betOver ? game.actualTotal > game.bookTotal : game.actualTotal < game.bookTotal;
                            })();

                            return (
                              <td key={key} className={`mp-pick ${winCorrect ? 'mp-correct' : 'mp-wrong'}`}>
                                <div className="mp-pick-winner">
                                  {winCorrect ? '✓' : '✗'} {abbr(pred.predWinner)}
                                </div>
                                {spreadBet && (
                                  <div className={`mp-pick-line ${spreadBet.covers ? 'mp-line-win' : 'mp-line-loss'}`}>
                                    {abbr(spreadBet.betTeam)} covers {spreadBet.betLine > 0 ? '+' : ''}{spreadBet.betLine.toFixed(1)}
                                    <span className="mp-bet-result"> {spreadBet.covers ? '✓' : '✗'}</span>
                                  </div>
                                )}
                                {pred.total != null && game.actualTotal != null && (
                                  <div className={`mp-pick-line ${totalBetResult === true ? 'mp-line-win' : totalBetResult === false ? 'mp-line-loss' : 'mp-line-ok'}`}>
                                    {game.bookTotal != null
                                      ? `${pred.total > game.bookTotal ? 'o' : 'u'}${game.bookTotal.toFixed(1)} (${game.actualTotal.toFixed(1)})`
                                      : `tot ${pred.total.toFixed(1)}→${game.actualTotal.toFixed(1)}`}
                                    {totalBetResult === true && <span className="mp-bet-result"> ✓</span>}
                                    {totalBetResult === false && <span className="mp-bet-result"> ✗</span>}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
