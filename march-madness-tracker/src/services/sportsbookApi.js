const ESPN_BASE = {
  mens:   'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball',
  womens: 'https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball',
};

// ── Name normalisation ─────────────────────────────────────────
// Maps lowercase ESPN full team name → bracket short name
const ESPN_TO_BRACKET = {
  'uconn huskies':                     'Connecticut',
  'connecticut huskies':               'Connecticut',
  'north carolina tar heels':          'N Carolina',
  'northern iowa panthers':            'N Iowa',
  "saint mary's gaels":                "St Mary's CA",
  "saint mary's (ca) gaels":           "St Mary's CA",
  'saint louis billikens':             'St Louis',
  'south florida bulls':               'S Florida',
  'north dakota state bison':          'N Dakota St',
  'mcneese cowboys':                   'McNeese St',
  'mcneese state cowboys':             'McNeese St',
  'kennesaw state owls':               'Kennesaw',
  'california baptist lancers':        'Cal Baptist',
  'prairie view a&m panthers':         'Prairie View',
  "queens university royals":          'Queens NC',
  "queens university of charlotte royals": 'Queens NC',
  "queens university of charlotte":    'Queens NC',
  'miami (oh) redhawks':               'Miami OH',
  'miami redhawks':                    'Miami OH',
  'miami hurricanes':                  'Miami FL',
  'southern methodist mustangs':       'SMU',
  'smu mustangs':                      'SMU',
  'wright state raiders':              'Wright St',
  'utah state aggies':                 'Utah St',
  'stephen f. austin lumberjacks':     'SF Austin',
  'stephen f. austin ladyjacks':       'SF Austin',
  'sf austin ladyjacks':               'SF Austin',
  'charleston cougars':                'Col Charleston',
  'southern lady jaguars':             'Southern Univ',
  'southern university lady jaguars':  'Southern Univ',
  'fairleigh dickinson knights':       'F Dickinson',
  'fairleigh dickinson lady knights':  'F Dickinson',
  'ole miss rebels':                   'Mississippi',
  'mississippi rebels':                'Mississippi',
  'oklahoma state cowgirls':           'Oklahoma St',
  'ut san antonio roadrunners':        'UT San Antonio',
  'utsa roadrunners':                  'UT San Antonio',
  'north carolina state wolfpack':     'NC State',
  'nc state wolfpack':                 'NC State',
  'pennsylvania quakers':              'Penn',
  'tennessee state tigers':            'Tennessee St',
  'south carolina gamecocks':          'S Carolina',
  'west virginia mountaineers':        'W Virginia',
  'southern illinois salukis':         'S Illinois',
  'south dakota state jackrabbits':    'S Dakota St',
  'uc san diego tritons':              'UC San Diego',
  'oklahoma state cowboys':            'Oklahoma St',
  'murray state racers':               'Murray St',
  'western illinois leathernecks':     'W Illinois',
  'college of charleston cougars':     'Col Charleston',
  'liu brooklyn blackbirds':           'LIU Brooklyn',
  'long island university sharks':     'LIU Brooklyn',
  'green bay phoenix':                 'WI Green Bay',
  'wisconsin-green bay phoenix':       'WI Green Bay',
  "st. john's red storm":              "St John's",
  "st john's red storm":               "St John's",
  'samford bulldogs':                  'Samford',
  'high point panthers':               'High Point',
  'jacksonville dolphins':             'Jacksonville',
  'holy cross crusaders':              'Holy Cross',
  'james madison dukes':               'James Madison',
  'rhode island rams':                 'Rhode Island',
  'fairfield stags':                   'Fairfield',
  'southern university jaguars':       'Southern Univ',
  'umbc retrievers':                   'UMBC',
  'lehigh mountain hawks':             'Lehigh',
};

function normaliseEspnName(name) {
  const lo = name.toLowerCase().trim();
  return ESPN_TO_BRACKET[lo] ?? name;
}

// Strips punctuation/asterisks for loose comparison
function nameForCompare(s) {
  return s.toLowerCase().replace(/[.'*]/g, '').replace(/\s+/g, ' ').trim();
}

// Does an ESPN team display name match a bracket short name?
function teamMatches(espnName, bracketName) {
  const clean = bracketName.replace(/\*$/, '');
  const norm  = normaliseEspnName(espnName);
  if (norm === clean) return true;
  const espnCmp    = nameForCompare(espnName);
  const bracketCmp = nameForCompare(clean);
  return espnCmp.includes(bracketCmp) || bracketCmp.includes(espnCmp);
}

// ── Fetch all events for one date (YYYYMMDD) ───────────────────
async function fetchEspnGamesForDate(dateStr, gender = 'mens') {
  const base = ESPN_BASE[gender] ?? ESPN_BASE.mens;
  // No groups filter — tournament games (incl. First Four) span all groups
  const url = `${base}/scoreboard?dates=${dateStr}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}

// ── For a play-in slot, resolve the actual bracket team name from ESPN display name ─
// Looks up the corresponding play-in game and uses teamMatches to find the right bracket name.
function resolvePlayinTeamName(espnName, playinSlot, allBracketGames) {
  if (playinSlot) {
    const pg = allBracketGames.find(g => g.round === 'playin' && g.playinSlot === playinSlot);
    if (pg) {
      if (teamMatches(espnName, pg.topTeam.name)) return pg.topTeam.name;
      if (teamMatches(espnName, pg.botTeam.name)) return pg.botTeam.name;
    }
  }
  return normaliseEspnName(espnName);
}

// ── Parse ESPN event → { dk: { moneyline, spread, total } } ───
// moneyline: { [teamName]: odds_string }
// spread:    { [teamName]: { line: string, odds: string } }
// total:     { line: number, overOdds: string, underOdds: string }
function parseEspnEvent(event, homeTeamName, awayTeamName) {
  const result = { dk: { moneyline: {}, spread: {}, total: null } };

  const odds = event.competitions?.[0]?.odds?.[0];
  if (!odds) return result;

  // Moneyline
  const homeML = odds.moneyline?.home?.close?.odds ?? null;
  const awayML = odds.moneyline?.away?.close?.odds ?? null;
  if (homeML != null) result.dk.moneyline[homeTeamName] = homeML;
  if (awayML != null) result.dk.moneyline[awayTeamName] = awayML;

  // Spread — both teams' line + odds from odds.pointSpread
  const homeSpreadLine = odds.pointSpread?.home?.close?.line ?? null;
  const homeSpreadOdds = odds.pointSpread?.home?.close?.odds ?? null;
  const awaySpreadLine = odds.pointSpread?.away?.close?.line ?? null;
  const awaySpreadOdds = odds.pointSpread?.away?.close?.odds ?? null;
  if (homeSpreadLine != null) result.dk.spread[homeTeamName] = { line: homeSpreadLine, odds: homeSpreadOdds };
  if (awaySpreadLine != null) result.dk.spread[awayTeamName] = { line: awaySpreadLine, odds: awaySpreadOdds };

  // Total
  if (odds.overUnder != null) {
    result.dk.total = {
      line:      odds.overUnder,
      overOdds:  odds.total?.over?.close?.odds ?? null,
      underOdds: odds.total?.under?.close?.odds ?? null,
    };
  }

  return result;
}

// ── Fetch pre-game odds from ESPN core API (works for completed/live games) ─
// Provider 100 = DraftKings; spread is from home team perspective (negative = home favored)
const CORE_BASE = {
  mens:   'mens-college-basketball',
  womens: 'womens-college-basketball',
};

async function fetchCoreOdds(eventId, gender = 'mens') {
  const league = CORE_BASE[gender] ?? CORE_BASE.mens;
  const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${league}/events/${eventId}/competitions/${eventId}/odds`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = (data.items ?? []).find(i => i.provider?.id === '100') ?? data.items?.[0];
    if (!item) return null;
    return {
      spread:       item.spread       ?? null,  // home team line, negative = home favored
      overUnder:    item.overUnder    ?? null,
      overOdds:     item.overOdds     ?? null,
      underOdds:    item.underOdds    ?? null,
      homeMoneyLine: item.homeTeamOdds?.moneyLine ?? null,
      awayMoneyLine: item.awayTeamOdds?.moneyLine ?? null,
    };
  } catch {
    return null;
  }
}

// ── Main: fetch odds for a set of bracket games ────────────────
// Fetches today + next 6 days in parallel to cover the current round
// Returns: { [gameId]: { dk: { moneyline, spread, total } } }
export async function fetchOddsForGames(bracketGames, gender = 'mens') {
  // Build date strings for 3 days back through next 6 days
  // Play-in games start 2 days before R64, so we need to look back
  const today = new Date();
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i - 7);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  });

  const allEventArrays = await Promise.all(dates.map(d => fetchEspnGamesForDate(d, gender)));
  const allEvents = allEventArrays.flat();
  console.log('[sportsbookApi] ESPN events found across 7 days:', allEvents.length);

  const relevantGames = bracketGames.filter(
    g => ['playin', 'r64', 'r32', 's16', 'e8', 'ff', 'championship'].includes(g.round)
  );

  const oddsMap = {};

  for (const event of allEvents) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const competitors = competition.competitors ?? [];
    const homeComp = competitors.find(c => c.homeAway === 'home');
    const awayComp = competitors.find(c => c.homeAway === 'away');
    if (!homeComp || !awayComp) continue;

    const homeApiName = homeComp.team.displayName;
    const awayApiName = awayComp.team.displayName;
    // Skip events where ESPN hasn't resolved the opponent yet
    if (homeApiName === 'TBD' || awayApiName === 'TBD') continue;

    for (const bracketGame of relevantGames) {
      // Skip if already matched AND has a completedWinner; otherwise keep trying
      if (oddsMap[bracketGame.id]?.completedWinner) continue;

      const top = bracketGame.topTeam?.name;
      const bot = bracketGame.botTeam?.name;
      if (!top || !bot) continue;

      let homeTeamBracket = null, awayTeamBracket = null;
      const topHasPlayin = top.endsWith('*');
      const botHasPlayin = bot.endsWith('*');

      if (teamMatches(homeApiName, top) && teamMatches(awayApiName, bot)) {
        homeTeamBracket = top.replace(/\*$/, '');
        awayTeamBracket = bot.replace(/\*$/, '');
      } else if (teamMatches(homeApiName, bot) && teamMatches(awayApiName, top)) {
        homeTeamBracket = bot.replace(/\*$/, '');
        awayTeamBracket = top.replace(/\*$/, '');
      } else if (topHasPlayin || botHasPlayin) {
        // One side is a play-in placeholder — match by the known (non-*) team only
        const fixedTeam  = topHasPlayin ? bot : top;
        const playinSlot = bracketGame.playinSlot ?? null;
        if (teamMatches(homeApiName, fixedTeam)) {
          homeTeamBracket = fixedTeam.replace(/\*$/, '');
          awayTeamBracket = resolvePlayinTeamName(awayApiName, playinSlot, relevantGames);
        } else if (teamMatches(awayApiName, fixedTeam)) {
          homeTeamBracket = resolvePlayinTeamName(homeApiName, playinSlot, relevantGames);
          awayTeamBracket = fixedTeam.replace(/\*$/, '');
        }
      }

      if (homeTeamBracket && awayTeamBracket) {
        const result = parseEspnEvent(event, homeTeamBracket, awayTeamBracket);
        result.startTime = event.date ?? competition.date ?? null;

        const statusType  = competition.status?.type ?? {};
        const isCompleted = statusType.completed === true;
        const isLive      = statusType.state === 'in';
        const statusText  = statusType.shortDetail ?? null;

        const homeScore = parseFloat(homeComp.score ?? '0');
        const awayScore = parseFloat(awayComp.score ?? '0');

        if (isCompleted) {
          const winnerComp = competitors.find(c => c.winner === true);
          if (winnerComp) {
            result.completedWinner = winnerComp.team.displayName === homeApiName
              ? homeTeamBracket
              : awayTeamBracket;
          }
          result.actualSpread = Math.abs(homeScore - awayScore);
          result.actualTotal  = homeScore + awayScore;
          result.scores = { [homeTeamBracket]: homeScore, [awayTeamBracket]: awayScore };
        } else if (isLive) {
          result.liveData = {
            statusText,
            scores: { [homeTeamBracket]: homeScore, [awayTeamBracket]: awayScore },
          };
        }

        result.espnEventId = event.id;
        oddsMap[bracketGame.id] = result;
        console.log(
          `[sportsbookApi] matched: "${top}" vs "${bot}"`,
          isCompleted ? `→ FINAL winner: ${result.completedWinner}` : ''
        );
        break;
      }
    }
  }

  // For live/completed games ESPN scoreboard returns empty odds.
  // Fetch pre-game closing lines from the core API which retains them permanently.
  const needsCoreOdds = Object.entries(oddsMap).filter(([, d]) => {
    const started = d.completedWinner || d.liveData;
    const hasDk   = d.dk?.total?.line != null || Object.keys(d.dk?.spread ?? {}).length > 0;
    return started && !hasDk && d.espnEventId;
  });

  if (needsCoreOdds.length) {
    console.log('[sportsbookApi] fetching core odds for', needsCoreOdds.length, 'live/completed game(s)');
    const coreResults = await Promise.all(
      needsCoreOdds.map(([id, d]) =>
        fetchCoreOdds(d.espnEventId, gender).then(core => ({ id, d, core }))
      )
    );
    for (const { id, d, core } of coreResults) {
      if (!core) continue;
      // Reconstruct dk spread keyed by bracket team name.
      // Recover team names from scores (completed) or liveData.scores (live).
      const scoreTeams = Object.keys(d.scores ?? d.liveData?.scores ?? {});
      const homeTeam   = scoreTeams[0] ?? null;
      const awayTeam   = scoreTeams[1] ?? null;
      const dk = { moneyline: {}, spread: {}, total: null };
      if (core.overUnder != null) {
        dk.total = { line: core.overUnder, overOdds: core.overOdds, underOdds: core.underOdds };
      }
      if (core.spread != null && homeTeam && awayTeam) {
        dk.spread[homeTeam] = { line: core.spread,         odds: null };
        dk.spread[awayTeam] = { line: -core.spread,        odds: null };
      }
      if (core.homeMoneyLine != null && homeTeam) dk.moneyline[homeTeam] = core.homeMoneyLine;
      if (core.awayMoneyLine != null && awayTeam) dk.moneyline[awayTeam] = core.awayMoneyLine;
      oddsMap[id] = { ...d, dk };
      console.log(`[sportsbookApi] core odds applied for event ${d.espnEventId}: total=${core.overUnder}, spread=${core.spread}`);
    }
  }

  // Log unmatched bracket games for debugging
  const unmatched = relevantGames.filter(g => !oddsMap[g.id] && g.topTeam?.name && g.botTeam?.name);
  if (unmatched.length) {
    console.warn('[sportsbookApi] unmatched bracket games:', unmatched.map(g => `${g.topTeam.name} vs ${g.botTeam.name}`));
  }
  console.log('[sportsbookApi] ESPN odds built for', Object.keys(oddsMap).length, '/', relevantGames.length, 'bracket games');
  return oddsMap;
}
