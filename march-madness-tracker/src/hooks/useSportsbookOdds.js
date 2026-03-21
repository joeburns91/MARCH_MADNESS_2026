import { useState, useEffect, useCallback } from 'react';
import { fetchOddsForGames } from '../services/sportsbookApi';

const storageKey = (gender) => `mm2026-odds-${gender}`;

function loadCached(gender) {
  try {
    const raw = localStorage.getItem(storageKey(gender));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCached(gender, oddsMap) {
  try {
    localStorage.setItem(storageKey(gender), JSON.stringify(oddsMap));
  } catch {}
}

export function useSportsbookOdds(games, gender = 'mens') {
  const [oddsMap, setOddsMap] = useState(() => loadCached(gender));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setOddsMap(loadCached(gender));
  }, [gender]);

  const refresh = useCallback(async () => {
    if (!games?.length) return;
    setLoading(true);
    setError(null);
    try {
      const prevCache = loadCached(gender);
      const odds = await fetchOddsForGames(games, gender);
      // For completed games where ESPN no longer returns book odds,
      // preserve the pre-game closing lines from cache so model vs. book
      // comparisons (over/under, spread bet) still work.
      const merged = { ...odds };
      // ESPN drops odds once a game goes live or completes.
      // Restore the pre-game lines from cache so model vs. book analysis works.
      for (const [id, newData] of Object.entries(merged)) {
        const gameStarted = newData.completedWinner || newData.liveData;
        if (gameStarted) {
          const hasOdds = newData.dk?.total?.line != null
            || Object.keys(newData.dk?.spread ?? {}).length > 0;
          if (!hasOdds && prevCache[id]?.dk) {
            merged[id] = { ...newData, dk: prevCache[id].dk };
          }
        }
      }
      // ESPN eventually drops completed games from the scoreboard entirely.
      // Preserve completedWinner (and closing odds) from cache for any game
      // that ESPN no longer returns so they stay filtered out of the table.
      for (const [id, cachedData] of Object.entries(prevCache)) {
        if (cachedData.completedWinner && !merged[id]) {
          merged[id] = cachedData;
        }
      }
      setOddsMap(merged);
      saveCached(gender, merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [games, gender]);

  // Auto-fetch on mount and whenever the gender (bracket) changes
  useEffect(() => {
    if (games?.length) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender]);

  return { oddsMap, loading, error, refresh };
}
