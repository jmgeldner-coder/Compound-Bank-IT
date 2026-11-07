import React, { useEffect, useMemo, useState } from 'react';
import { ref, set, onValue, off, runTransaction } from 'firebase/database';
import { db } from './firebase';
import {
  Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Users, Trophy, Tv, Landmark,
  Plus, Trash2, User, Play, RotateCcw, Hand, X,
} from 'lucide-react';

/* ───────────────────────── Settings ───────────────────────── */
const APP_NAME = 'Bank It';
const K = { players: 'bank-players', game: 'bank-game', stats: 'bank-stats' };
const ROUND_CHOICES = [10, 15, 20];

/* ───────────────────────── Colors — every color lives here ───────────────────────── */
const C = {
  bg: '#0B1F17',          // dark felt
  surface: '#123326',
  surfaceLight: '#1B4535',
  gold: '#F5C542',        // bank / headings
  accent: '#FF7A45',      // active / alerts
  yes: '#4ADE80',         // banked
  bust: '#EF4444',
  text: '#F2F7F4',
  textMuted: '#9DB8AB',
  border: '#2A5A47',
  die: '#FFFDF5',
  pip: '#1B1B1B',
};

/* ───────────────────────── Firebase helpers ───────────────────────── */
const sharedSet = (key, value) => set(ref(db, key), value === undefined ? null : value);
function sharedSubscribe(key, cb) {
  const r = ref(db, key);
  onValue(r, snap => cb(snap.exists() ? snap.val() : null));
  return () => off(r);
}
const toArray = v => (Array.isArray(v) ? v.filter(x => x != null) : v ? Object.values(v) : []);
const BAD_KEY_CHARS = /[.#$[\]/]/;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

/* ───────────────────────── Game rules (pure functions) ───────────────────────── */
export function normalize(g) {
  if (!g) return null;
  return {
    status: g.status || 'lobby',
    rounds: g.rounds || 20,
    round: g.round || 1,
    rollCount: g.rollCount || 0,
    bank: g.bank || 0,
    turnIdx: g.turnIdx || 0,
    players: toArray(g.players),
    banked: g.banked || {},
    scores: g.scores || {},
    lastRoll: g.lastRoll || null,
    log: toArray(g.log),
    statsSaved: !!g.statsSaved,
  };
}
const newLobby = () => ({ status: 'lobby', rounds: 20, players: [] });

function nextUnbanked(g, fromIdx) {
  const n = g.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n;
    if (!g.banked[g.players[idx]]) return idx;
  }
  return -1;
}
function addLog(g, text) {
  g.log = [...g.log, { r: g.round, text }].slice(-40);
}
function endRound(g) {
  if (g.round >= g.rounds) {
    g.status = 'over';
    addLog(g, 'Game over!');
    return;
  }
  g.round += 1;
  g.bank = 0;
  g.rollCount = 0;
  g.banked = {};
  g.turnIdx = (g.round - 1) % g.players.length; // starting roller rotates each round
}

export function applyRoll(g, d1, d2, by) {
  const sum = d1 + d2;
  const doubles = d1 === d2;
  const n = g.rollCount + 1;
  const roller = g.players[g.turnIdx];
  let note;
  let bust = false;

  if (n <= 3) {
    if (sum === 7) { g.bank += 70; note = '7 in the first three rolls: +70'; }
    else { g.bank += sum; note = doubles ? `Doubles (first three): +${sum}` : `+${sum}`; }
  } else if (sum === 7) {
    bust = true; note = 'BUST! Bank wiped out';
  } else if (doubles) {
    g.bank *= 2; note = 'DOUBLES! Bank doubled';
  } else {
    g.bank += sum; note = `+${sum}`;
  }

  g.rollCount = n;
  g.lastRoll = { d1, d2, roller, by: by || roller, note, bust, round: g.round, n };
  addLog(g, `${roller} rolled ${d1}+${d2} — ${note}${bust ? '' : ` (bank ${g.bank})`}`);

  if (bust) { g.bank = 0; endRound(g); }
  else { g.turnIdx = nextUnbanked(g, g.turnIdx); }
  return g;
}

export function applyBank(g, name) {
  if (g.banked[name] || g.bank <= 0) return g;
  g.scores = { ...g.scores, [name]: (g.scores[name] || 0) + g.bank };
  g.banked = { ...g.banked, [name]: true };
  addLog(g, `${name} banked ${g.bank}`);
  const everyoneBanked = g.players.every(p => g.banked[p]);
  if (everyoneBanked) { addLog(g, 'Everyone banked — round over'); endRound(g); }
  else if (g.players[g.turnIdx] === name) g.turnIdx = nextUnbanked(g, g.turnIdx);
  return g;
}

/* Run a change against the live game safely, even if several people tap at once. */
async function updateGame(fn) {
  let before = null;
  const res = await runTransaction(ref(db, K.game), raw => {
    const g = normalize(raw) || newLobby();
    before = g.status;
    return fn(JSON.parse(JSON.stringify(g)));
  });
  const after = normalize(res.snapshot.val());
  if (res.committed && after && after.status === 'over' && before !== 'over' && !after.statsSaved) {
    await saveStats(after);
  }
}

async function saveStats(g) {
  const top = Math.max(0, ...g.players.map(p => g.scores[p] || 0));
  await runTransaction(ref(db, K.stats), raw => {
    const s = raw || {};
    g.players.forEach(p => {
      const score = g.scores[p] || 0;
      const cur = s[p] || { played: 0, wins: 0, high: 0, total: 0 };
      s[p] = {
        played: cur.played + 1,
        wins: cur.wins + (score === top && top > 0 ? 1 : 0),
        high: Math.max(cur.high, score),
        total: cur.total + score,
      };
    });
    return s;
  });
  await sharedSet(`${K.game}/statsSaved`, true);
}

/* ───────────────────────── Shared UI bits ───────────────────────── */
const DICE = [null, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
function Die({ value, size = 56, rolling }) {
  const Icon = DICE[value] || Dice6;
  return (
    <span className={`inline-flex rounded-xl ${rolling ? 'animate-spin' : ''}`} style={{ background: C.die, padding: size * 0.06 }}>
      <Icon size={size} strokeWidth={1.6} style={{ color: C.pip }} />
    </span>
  );
}
function Card({ children, style }) {
  return <div className="rounded-xl p-4 mb-3" style={{ background: C.surface, border: `1px solid ${C.border}`, ...style }}>{children}</div>;
}
function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="text-center py-12 px-4" style={{ color: C.textMuted }}>
      <Icon className="mx-auto mb-3" size={36} />
      <div className="font-semibold mb-1" style={{ color: C.text }}>{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
function Btn({ children, onClick, color = C.surfaceLight, textColor = C.text, disabled, big, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold disabled:opacity-40 ${big ? 'px-5 py-4 text-lg w-full' : 'px-3.5 py-2'}`}
      style={{ background: color, color: textColor }}>{children}</button>
  );
}
function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center py-2 text-xs"
      style={{ color: active ? C.accent : C.textMuted, borderTop: `2px solid ${active ? C.accent : 'transparent'}` }}>
      <Icon size={20} /><span className="mt-0.5">{label}</span>
    </button>
  );
}
const inputStyle = { background: C.surfaceLight, color: C.text, border: `1px solid ${C.border}` };

/* ───────────────────────── Root ───────────────────────── */
export default function BankIt() {
  const [roster, setRoster] = useState([]);
  const [gameRaw, setGameRaw] = useState(null);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [me, setMeState] = useState(() => ls.get('bank-me') || '');
  const [tab, setTab] = useState('table');
  const [screen, setScreen] = useState(() => new URLSearchParams(window.location.search).has('screen'));

  const setMe = n => { setMeState(n); ls.set('bank-me', n); };

  useEffect(() => {
    const TOTAL = 3;
    const seen = new Set();
    const markReady = k => { seen.add(k); if (seen.size >= TOTAL) setLoading(false); };
    const unsubs = [
      sharedSubscribe(K.players, v => { setRoster(toArray(v)); markReady('players'); }),
      sharedSubscribe(K.game, v => { setGameRaw(v); markReady('game'); }),
      sharedSubscribe(K.stats, v => { setStats(v || {}); markReady('stats'); }),
    ];
    const fallback = setTimeout(() => setLoading(false), 5000);
    return () => { unsubs.forEach(u => u()); clearTimeout(fallback); };
  }, []);

  const game = useMemo(() => normalize(gameRaw) || normalize(newLobby()), [gameRaw]);
  const meValid = me && roster.includes(me) ? me : '';

  if (screen) return <LiveScreen game={game} loading={loading} onExit={() => { setScreen(false); window.history.replaceState({}, '', window.location.pathname); }} />;

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
        <header className="flex items-center justify-between gap-3 mb-5">
          <h1 className="text-2xl font-extrabold flex items-center gap-2" style={{ color: C.gold }}><Landmark size={24} /> {APP_NAME}</h1>
          <label className="flex items-center gap-2 text-sm" style={{ color: C.textMuted }}>
            <User size={16} />
            <select value={meValid} onChange={e => setMe(e.target.value)} className="rounded-lg px-2 py-1.5" style={inputStyle}>
              <option value="">Who are you?</option>
              {roster.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </header>

        {loading ? <EmptyState icon={Dice6} title="Loading…">Joining the table.</EmptyState> : (
          <>
            {tab === 'table' && <TableView game={game} me={meValid} roster={roster} goTo={setTab} />}
            {tab === 'stats' && <StatsView stats={stats} roster={roster} />}
            {tab === 'players' && <PlayersView roster={roster} game={game} />}
          </>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0" style={{ background: C.surface, borderTop: `1px solid ${C.border}`, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-3xl mx-auto grid grid-cols-4">
          <TabButton icon={Dice6} label="Table" active={tab === 'table'} onClick={() => setTab('table')} />
          <TabButton icon={Trophy} label="Stats" active={tab === 'stats'} onClick={() => setTab('stats')} />
          <TabButton icon={Users} label="Players" active={tab === 'players'} onClick={() => setTab('players')} />
          <TabButton icon={Tv} label="Live Screen" active={false} onClick={() => setScreen(true)} />
        </div>
      </nav>
    </div>
  );
}

/* ───────────────────────── Table: lobby, play, game over ───────────────────────── */
function TableView({ game, me, roster, goTo }) {
  if (!roster.length) return <EmptyState icon={Users} title="No players yet">Add names on the <button className="underline" onClick={() => goTo('players')}>Players</button> tab.</EmptyState>;
  if (game.status === 'lobby') return <Lobby game={game} me={me} />;
  if (game.status === 'over') return <GameOver game={game} />;
  return <Playing game={game} me={me} />;
}

function Lobby({ game, me }) {
  const joined = me && game.players.includes(me);
  return (
    <div>
      <Card>
        <div className="font-bold text-lg mb-1" style={{ color: C.gold }}>New game</div>
        <div className="text-sm mb-4" style={{ color: C.textMuted }}>Everyone picks their name at the top and taps Join. Then anyone can start.</div>
        {!me ? <div className="text-sm" style={{ color: C.accent }}>Pick your name at the top first.</div> : (
          <Btn big onClick={() => updateGame(g => { g.players = joined ? g.players.filter(p => p !== me) : [...g.players, me]; return g; })}
            color={joined ? C.surfaceLight : C.accent} textColor={joined ? C.text : '#111'}>
            {joined ? <><X size={18} /> Leave table</> : <><Plus size={18} /> Join table</>}
          </Btn>
        )}
      </Card>

      <Card>
        <div className="text-sm mb-2" style={{ color: C.textMuted }}>At the table ({game.players.length})</div>
        {game.players.length === 0 ? <div className="text-sm" style={{ color: C.textMuted }}>Nobody yet.</div>
          : <div className="flex flex-wrap gap-2">{game.players.map(p => (
              <span key={p} className="px-3 py-1.5 rounded-full text-sm font-medium" style={{ background: C.surfaceLight }}>{p}</span>
            ))}</div>}
      </Card>

      <Card>
        <div className="text-sm mb-2" style={{ color: C.textMuted }}>Rounds</div>
        <div className="flex gap-2 mb-4">
          {ROUND_CHOICES.map(r => (
            <button key={r} onClick={() => updateGame(g => { g.rounds = r; return g; })}
              className="flex-1 rounded-lg py-2 font-semibold"
              style={{ background: game.rounds === r ? C.gold : C.surfaceLight, color: game.rounds === r ? '#111' : C.text }}>{r}</button>
          ))}
        </div>
        <Btn big disabled={game.players.length < 2} color={C.yes} textColor="#111"
          onClick={() => updateGame(g => ({
            ...g, status: 'playing', round: 1, rollCount: 0, bank: 0, turnIdx: 0,
            banked: {}, scores: {}, lastRoll: null, log: [{ r: 1, text: 'Game started' }], statsSaved: false,
          }))}>
          <Play size={18} /> Start game
        </Btn>
        {game.players.length < 2 && <div className="text-xs mt-2 text-center" style={{ color: C.textMuted }}>Need at least 2 players.</div>}
      </Card>
    </div>
  );
}

function Playing({ game, me }) {
  const [mode, setMode] = useState(() => ls.get('bank-dice-mode') || 'app');
  const [rolling, setRolling] = useState(false);
  const [real, setReal] = useState([0, 0]);
  const roller = game.players[game.turnIdx];
  const inGame = me && game.players.includes(me);
  const myBanked = inGame && game.banked[me];
  const changeMode = m => { setMode(m); ls.set('bank-dice-mode', m); };

  const submitRoll = (d1, d2) => updateGame(g => (g.status === 'playing' ? applyRoll(g, d1, d2, me) : g));

  const rollApp = () => {
    setRolling(true);
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    setTimeout(() => { submitRoll(d1, d2); setRolling(false); }, 600);
  };
  const rollReal = () => { submitRoll(real[0], real[1]); setReal([0, 0]); };

  const lr = game.lastRoll;
  const showLast = lr && lr.round === game.round || (lr && lr.bust);

  return (
    <div>
      <Card style={{ textAlign: 'center' }}>
        <div className="text-sm" style={{ color: C.textMuted }}>Round {game.round} of {game.rounds} · Roll {game.rollCount + 1}{game.rollCount < 3 ? ' (safe — 7 is worth 70)' : ''}</div>
        <div className="text-xs uppercase tracking-widest mt-3" style={{ color: C.textMuted }}>Bank</div>
        <div className="text-6xl font-black" style={{ color: C.gold }}>{game.bank}</div>
        {showLast && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <Die value={lr.d1} size={36} /><Die value={lr.d2} size={36} />
            <span className="text-sm font-semibold text-left" style={{ color: lr.bust ? C.bust : C.text }}>{lr.roller}: {lr.note}</span>
          </div>
        )}
      </Card>

      {inGame && (
        <Btn big disabled={myBanked || game.bank <= 0} color={C.gold} textColor="#111"
          onClick={() => updateGame(g => (g.status === 'playing' ? applyBank(g, me) : g))}>
          <Hand size={20} /> {myBanked ? 'Banked — sitting out this round' : `BANK ${game.bank}`}
        </Btn>
      )}

      <Card style={{ marginTop: 12 }}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">{roller === me ? 'Your roll!' : `${roller}'s roll`}</div>
          <div className="flex rounded-lg overflow-hidden text-sm" style={{ border: `1px solid ${C.border}` }}>
            {[['app', 'App dice'], ['real', 'Real dice']].map(([k, l]) => (
              <button key={k} onClick={() => changeMode(k)} className="px-3 py-1.5"
                style={{ background: mode === k ? C.surfaceLight : 'transparent', color: mode === k ? C.text : C.textMuted }}>{l}</button>
            ))}
          </div>
        </div>
        {mode === 'app' ? (
          <div className="text-center">
            <div className="flex justify-center gap-4 mb-4">
              <Die value={rolling ? 6 : lr?.d1 || 1} rolling={rolling} /><Die value={rolling ? 6 : lr?.d2 || 1} rolling={rolling} />
            </div>
            <Btn big onClick={rollApp} disabled={rolling} color={C.accent} textColor="#111"><Dice6 size={20} /> Roll for {roller}</Btn>
          </div>
        ) : (
          <div>
            {[0, 1].map(i => (
              <div key={i} className="flex gap-1.5 mb-2">
                {[1, 2, 3, 4, 5, 6].map(v => (
                  <button key={v} onClick={() => setReal(r => { const n = [...r]; n[i] = v; return n; })}
                    className="flex-1 rounded-lg py-1.5 flex justify-center"
                    style={{ background: real[i] === v ? C.gold : C.surfaceLight }}>
                    {React.createElement(DICE[v], { size: 26, style: { color: real[i] === v ? '#111' : C.text } })}
                  </button>
                ))}
              </div>
            ))}
            <Btn big onClick={rollReal} disabled={!real[0] || !real[1]} color={C.accent} textColor="#111">
              Enter {real[0] && real[1] ? `${real[0]} + ${real[1]}` : 'roll'} for {roller}
            </Btn>
          </div>
        )}
      </Card>

      <Scoreboard game={game} />

      <Card>
        <div className="text-sm mb-2" style={{ color: C.textMuted }}>Play by play</div>
        <div className="text-sm space-y-1 max-h-48 overflow-y-auto">
          {[...game.log].reverse().map((l, i) => <div key={i}><span style={{ color: C.textMuted }}>R{l.r}</span> {l.text}</div>)}
        </div>
      </Card>

      <div className="text-center mt-4">
        <button className="text-sm underline" style={{ color: C.textMuted }}
          onClick={() => window.confirm('End this game for everyone and go back to the lobby? Scores will not be saved.') && sharedSet(K.game, { ...newLobby(), players: game.players, rounds: game.rounds })}>
          Abandon game
        </button>
      </div>
    </div>
  );
}

function Scoreboard({ game, large }) {
  const ranked = [...game.players].sort((a, b) => (game.scores[b] || 0) - (game.scores[a] || 0));
  const roller = game.status === 'playing' ? game.players[game.turnIdx] : null;
  return (
    <Card>
      {!large && <div className="text-sm mb-2" style={{ color: C.textMuted }}>Scores</div>}
      {ranked.map((p, i) => {
        const banked = game.banked[p];
        return (
          <div key={p} className={`flex items-center justify-between ${large ? 'py-3 text-3xl' : 'py-2'}`} style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
            <span className="flex items-center gap-2">
              <span style={{ color: C.textMuted, width: large ? 40 : 20 }}>{i + 1}</span>
              <span className="font-semibold" style={{ color: p === roller ? C.accent : C.text }}>{p}</span>
              {p === roller && <Dice6 size={large ? 28 : 16} style={{ color: C.accent }} />}
              {game.status === 'playing' && banked && <span className={`rounded-full px-2 ${large ? 'text-lg' : 'text-xs'}`} style={{ background: C.yes, color: '#111' }}>banked</span>}
            </span>
            <span className="font-bold" style={{ color: C.gold }}>{game.scores[p] || 0}</span>
          </div>
        );
      })}
    </Card>
  );
}

function GameOver({ game }) {
  const top = Math.max(0, ...game.players.map(p => game.scores[p] || 0));
  const winners = game.players.filter(p => (game.scores[p] || 0) === top);
  return (
    <div>
      <Card style={{ textAlign: 'center' }}>
        <Trophy className="mx-auto mb-2" size={44} style={{ color: C.gold }} />
        <div className="text-2xl font-black" style={{ color: C.gold }}>{winners.join(' & ')} win{winners.length === 1 ? 's' : ''}!</div>
        <div style={{ color: C.textMuted }}>{top} points</div>
      </Card>
      <Scoreboard game={game} />
      <Btn big color={C.yes} textColor="#111" onClick={() => sharedSet(K.game, { ...newLobby(), players: game.players, rounds: game.rounds })}>
        <RotateCcw size={18} /> Play again
      </Btn>
    </div>
  );
}

/* ───────────────────────── Live Screen (for a TV / big display) ───────────────────────── */
function LiveScreen({ game, loading, onExit }) {
  const lr = game.lastRoll;
  const roller = game.players[game.turnIdx];
  const top = Math.max(0, ...game.players.map(p => game.scores[p] || 0));
  return (
    <div className="min-h-screen p-8" style={{ background: C.bg, color: C.text }}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-5xl font-black flex items-center gap-3" style={{ color: C.gold }}><Landmark size={48} /> {APP_NAME}</h1>
        <button onClick={onExit} className="text-sm underline" style={{ color: C.textMuted }}>Exit live screen</button>
      </div>
      {loading ? <div className="text-3xl">Loading…</div>
        : game.status === 'lobby' ? (
          <div className="text-center mt-16">
            <div className="text-5xl font-bold mb-6">Waiting for players…</div>
            <div className="text-3xl" style={{ color: C.textMuted }}>{game.players.join(' · ') || 'Join on your phone'}</div>
          </div>
        ) : (
          <div className="grid gap-8" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
            <div className="rounded-3xl p-8 text-center" style={{ background: C.surface, border: `2px solid ${lr?.bust && game.status === 'playing' && game.rollCount === 0 ? C.bust : C.border}` }}>
              {game.status === 'over' ? (
                <>
                  <Trophy className="mx-auto" size={120} style={{ color: C.gold }} />
                  <div className="text-6xl font-black mt-4" style={{ color: C.gold }}>
                    {game.players.filter(p => (game.scores[p] || 0) === top).join(' & ')} win!
                  </div>
                </>
              ) : (
                <>
                  <div className="text-3xl" style={{ color: C.textMuted }}>Round {game.round} of {game.rounds} · Roll {game.rollCount + 1}</div>
                  <div className="text-2xl uppercase tracking-widest mt-6" style={{ color: C.textMuted }}>Bank</div>
                  <div className="font-black leading-none" style={{ color: C.gold, fontSize: 'min(22vw, 220px)' }}>{game.bank}</div>
                  {lr && (
                    <div className="mt-6 flex items-center justify-center gap-6">
                      <Die value={lr.d1} size={110} /><Die value={lr.d2} size={110} />
                    </div>
                  )}
                  {lr && <div className="text-4xl font-bold mt-5" style={{ color: lr.bust ? C.bust : C.text }}>{lr.roller}: {lr.note}</div>}
                  <div className="text-3xl mt-6" style={{ color: C.accent }}>Up next: {roller}</div>
                </>
              )}
            </div>
            <Scoreboard game={game} large />
          </div>
        )}
    </div>
  );
}

/* ───────────────────────── Stats ───────────────────────── */
function StatsView({ stats, roster }) {
  const names = Array.from(new Set([...roster, ...Object.keys(stats)])).filter(n => stats[n]);
  if (!names.length) return <EmptyState icon={Trophy} title="No games yet">Stats show up after the first finished game.</EmptyState>;
  const rows = names.map(n => ({ n, ...stats[n], avg: stats[n].played ? Math.round(stats[n].total / stats[n].played) : 0 }))
    .sort((a, b) => b.wins - a.wins || b.high - a.high);
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table className="w-full text-sm">
        <thead><tr style={{ background: C.surfaceLight }}>
          {['Player', 'Games', 'Wins', 'Best', 'Avg'].map(h => <th key={h} className={`px-3 py-2 ${h === 'Player' ? 'text-left' : 'text-right'}`}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.n} style={{ borderTop: `1px solid ${C.border}` }}>
            <td className="px-3 py-2 font-semibold">{r.n}</td>
            <td className="px-3 py-2 text-right">{r.played}</td>
            <td className="px-3 py-2 text-right" style={{ color: C.gold }}>{r.wins}</td>
            <td className="px-3 py-2 text-right">{r.high}</td>
            <td className="px-3 py-2 text-right">{r.avg}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

/* ───────────────────────── Players (names only) ───────────────────────── */
function PlayersView({ roster, game }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (BAD_KEY_CHARS.test(n)) { setErr("Names can't include . # $ [ ] or /"); return; }
    if (roster.includes(n)) { setErr('That name is already on the list.'); return; }
    sharedSet(K.players, [...roster, n]); setName(''); setErr('');
  };
  const remove = n => {
    if (game.status === 'playing' && game.players.includes(n)) { setErr(`${n} is in the current game.`); return; }
    if (window.confirm(`Remove ${n}? Their stats stay saved.`)) sharedSet(K.players, roster.filter(x => x !== n));
  };
  return (
    <div>
      <Card>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Add a player's name" className="flex-1 min-w-0 rounded-lg px-3 py-2" style={inputStyle} />
          <Btn onClick={add} color={C.accent} textColor="#111"><Plus size={16} /> Add</Btn>
        </div>
        {err && <div className="text-xs mt-2" style={{ color: C.bust }}>{err}</div>}
      </Card>
      {roster.length === 0 ? <EmptyState icon={Users} title="No players yet">Add the first name above.</EmptyState>
        : <Card>{roster.map((n, i) => (
            <div key={n} className="flex items-center justify-between py-2" style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
              <span>{n}</span>
              <button onClick={() => remove(n)} title="Remove" style={{ color: C.textMuted }}><Trash2 size={16} /></button>
            </div>
          ))}</Card>}
    </div>
  );
}
