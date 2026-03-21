import { useEffect, useState, useCallback, useMemo } from 'react';
import { useBracketState } from '../hooks/useBracketState';
import { useSportsbookOdds } from '../hooks/useSportsbookOdds';
import BracketView from './BracketView';
import PredictionsTable from './PredictionsTable';
import ModelSummary from './ModelSummary';
import BracketPickerModal from './BracketPickerModal';

export default function TournamentView({ gender }) {
  const state = useBracketState(gender);

  // For odds fetching, substitute resolved team names so that R32+ games
  // match ESPN events by actual winners rather than originally-seeded teams.
  const resolvedGames = useMemo(() =>
    state.games.map(game => {
      const { topTeam, botTeam } = state.resolveTeams(game);
      if (topTeam && botTeam) return { ...game, topTeam, botTeam };
      return game;
    }),
    [state.games, state.resolveTeams]
  );

  const { oddsMap, loading: oddsLoading, error: oddsError, refresh: refreshOdds } = useSportsbookOdds(resolvedGames, gender);

  const [builderMode, setBuilderMode]       = useState(false);
  const [confirmedGames, setConfirmedGames] = useState(new Set());
  const [activeGame, setActiveGame]         = useState(null); // { game, topTeam, botTeam }

  // Auto-fill winners for completed games from ESPN results
  useEffect(() => {
    for (const [gameId, data] of Object.entries(oddsMap)) {
      if (data.completedWinner && state.selections[gameId] !== data.completedWinner) {
        state.setWinner(gameId, data.completedWinner);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsMap]);

  // Auto-reveal predictions for any round whose matchups are fully determined
  useEffect(() => {
    if (state.nextPredictableRound) {
      state.predictRound(state.nextPredictableRound);
    }
  }, [state.nextPredictableRound, state.predictRound]);

  const handleGameClick = useCallback((game) => {
    if (!builderMode) return;
    const { topTeam, botTeam } = state.resolveTeams(game);
    if (!topTeam || !botTeam) return;
    setActiveGame({ game, topTeam, botTeam });
  }, [builderMode, state]);

  const handleConfirm = useCallback((teamName) => {
    if (!activeGame) return;
    state.setWinner(activeGame.game.id, teamName);
    setConfirmedGames(prev => new Set([...prev, activeGame.game.id]));
    setActiveGame(null);
  }, [activeGame, state]);

  const handleClear = useCallback(() => {
    state.clearAll();
    setConfirmedGames(new Set());
  }, [state]);

  const handlePrint = useCallback(() => {
    const bracket = document.querySelector('.bracket-view');

    // Compute scale to fit bracket width into a landscape letter page
    // (11in × 8.5in at 96 dpi = 1056 × 816px; ~0.5in margins each side → ~960px usable)
    const printableWidth = 960;
    const naturalWidth = bracket ? bracket.scrollWidth : printableWidth;
    const scale = Math.min(1, printableWidth / naturalWidth).toFixed(4);

    const styleEl = document.createElement('style');
    styleEl.id = '__bracket_print_style__';
    styleEl.textContent = `
      @page { size: landscape; margin: 0.4in; }
      @media print {
        html, body, #root,
        .app, .app-main, .tournament-view, .bracket-container {
          overflow: visible !important;
          height: auto !important;
          width: auto !important;
        }
        .bracket-view { zoom: ${scale}; }
        .builder-toolbar, .predictions-table-section,
        .model-summary-section, .app-header, .tab-bar { display: none !important; }

        /* Force background colours to print */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        /* Selected / advancing team — bold left bar + strong text */
        .team-selected,
        .team-correct {
          background: rgba(88, 166, 255, 0.18) !important;
          border-left: 3px solid #1a6fc4 !important;
        }
        .team-selected .team-name,
        .team-correct .team-name {
          font-weight: 800 !important;
          font-size: 12px !important;
          color: #000 !important;
        }
        .team-selected .team-seed,
        .team-correct .team-seed {
          font-weight: 700 !important;
          color: #000 !important;
        }

        /* Losing / non-selected team — visually dimmed */
        .team-row:not(.team-selected):not(.team-correct):not(.team-tbd) .team-name {
          color: #999 !important;
          font-weight: 400 !important;
        }
        .team-row:not(.team-selected):not(.team-correct):not(.team-tbd) .team-seed {
          color: #bbb !important;
        }

        /* Keep game-card background light for contrast */
        .game-card-inner {
          background: #fff !important;
          border-color: #ccc !important;
        }
        .game-meta {
          background: #f4f4f4 !important;
          border-color: #ddd !important;
        }
      }
    `;
    document.head.appendChild(styleEl);

    window.addEventListener('afterprint', () => {
      document.getElementById('__bracket_print_style__')?.remove();
    }, { once: true });

    window.print();
  }, []);

  return (
    <div className="tournament-view">

      <div className="builder-toolbar">
        <button
          className={`builder-toggle-btn${builderMode ? ' builder-mode-active' : ''}`}
          onClick={() => setBuilderMode(m => !m)}
        >
          ✏ Bracket Builder{builderMode ? ': ON' : ''}
        </button>
        {builderMode && (
          <>
            <button className="builder-print-btn" onClick={handlePrint}>
              Print Bracket
            </button>
            <button className="builder-clear-btn" onClick={handleClear}>
              Clear Bracket
            </button>
          </>
        )}
      </div>

      <div className="bracket-container">
        <BracketView
          games={state.games}
          selections={state.selections}
          predictedRounds={state.predictedRounds}
          resolveTeams={state.resolveTeams}
          builderMode={builderMode}
          onGameClick={handleGameClick}
          oddsMap={oddsMap}
          gender={gender}
        />
        <PredictionsTable
          games={state.games}
          predictedRounds={state.predictedRounds}
          resolveTeams={state.resolveTeams}
          oddsMap={oddsMap}
          oddsLoading={oddsLoading}
          oddsError={oddsError}
          onRefreshOdds={refreshOdds}
          gender={gender}
          confirmedGames={confirmedGames}
        />
      </div>

      <ModelSummary />

      {activeGame && (
        <BracketPickerModal
          game={activeGame.game}
          topTeam={activeGame.topTeam}
          botTeam={activeGame.botTeam}
          currentSelection={state.selections[activeGame.game.id] ?? null}
          gender={gender}
          onConfirm={handleConfirm}
          onClose={() => setActiveGame(null)}
        />
      )}
    </div>
  );
}
