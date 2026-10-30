import { useState, useEffect, useCallback, useRef } from "react";
import { hostRoom, joinRoom, sendState, closeRoom } from "./p2p";
import { appendAnalytic, loadAnalytics } from "./analytics";

// ── helpers ──────────────────────────────────────────────────────────────────

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Dynamic win checker for any grid size
function checkWinner(board, gridSize) {
  const winLength = gridSize >= 5 ? 4 : gridSize; // 4-in-a-row for 5x5+, otherwise full line
  const lines = [];
  
  // Rows
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c <= gridSize - winLength; c++) {
      const line = [];
      for (let k = 0; k < winLength; k++) line.push(r * gridSize + c + k);
      lines.push(line);
    }
  }
  
  // Columns
  for (let c = 0; c < gridSize; c++) {
    for (let r = 0; r <= gridSize - winLength; r++) {
      const line = [];
      for (let k = 0; k < winLength; k++) line.push((r + k) * gridSize + c);
      lines.push(line);
    }
  }
  
  // Diagonals (top-left to bottom-right)
  for (let r = 0; r <= gridSize - winLength; r++) {
    for (let c = 0; c <= gridSize - winLength; c++) {
      const line = [];
      for (let k = 0; k < winLength; k++) line.push((r + k) * gridSize + c + k);
      lines.push(line);
    }
  }
  
  // Diagonals (top-right to bottom-left)
  for (let r = 0; r <= gridSize - winLength; r++) {
    for (let c = winLength - 1; c < gridSize; c++) {
      const line = [];
      for (let k = 0; k < winLength; k++) line.push((r + k) * gridSize + c - k);
      lines.push(line);
    }
  }
  
  for (const line of lines) {
    const first = board[line[0]];
    if (first && line.every(idx => board[idx] === first)) {
      return { winner: first, line };
    }
  }
  
  if (board.every(c => c !== "")) return { winner: "draw", line: [] };
  return null;
}

function fmtDuration(ms) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s/60)}m ${s%60}s`;
}

function fmtHour(h) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#0a0a0f;}
.btn{
  background:transparent;border:2px solid #e8e8e0;color:#e8e8e0;
  padding:11px 26px;font-family:'Space Mono',monospace;font-size:13px;
  letter-spacing:2px;text-transform:uppercase;cursor:pointer;transition:all .15s;
}
.btn:hover{background:#e8e8e0;color:#0a0a0f;}
.btn:disabled{opacity:.35;cursor:not-allowed;}
.btn-red{border-color:#ff4d5a;color:#ff4d5a;}
.btn-red:hover{background:#ff4d5a;color:#0a0a0f;}
.btn-cyan{border-color:#4de8ff;color:#4de8ff;}
.btn-cyan:hover{background:#4de8ff;color:#0a0a0f;}
.inp{
  background:transparent;border:2px solid #2a2a3a;color:#e8e8e0;
  padding:11px 14px;font-family:'Space Mono',monospace;font-size:14px;
  letter-spacing:2px;outline:none;transition:border-color .15s;width:100%;
}
.inp:focus{border-color:#e8e8e0;}
.inp.code-inp{font-size:20px;letter-spacing:8px;text-align:center;text-transform:uppercase;}
.cell{
  width:100px;height:100px;background:transparent;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue',sans-serif;font-size:54px;transition:background .12s;
}
.cell:hover:not(:disabled){background:rgba(255,255,255,.04);}
.cell:disabled{cursor:not-allowed;}
.cell.X{color:#ff4d5a;}
.cell.O{color:#4de8ff;}
.cell.win{background:rgba(255,255,255,.07);}
.label{font-size:10px;letter-spacing:3px;color:#444;text-transform:uppercase;margin-bottom:5px;}
.ttl{font-family:'Bebas Neue',sans-serif;letter-spacing:6px;}
.fade{animation:fadeIn .3s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.blink{animation:blink 1.1s infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.bar-wrap{background:#1a1a2a;height:8px;border-radius:2px;overflow:hidden;flex:1;}
.bar{height:100%;border-radius:2px;transition:width .6s ease;}
.admin-card{background:#111118;border:1px solid #1e1e2e;padding:24px;margin-bottom:14px;}
.stat-big{font-family:'Bebas Neue',sans-serif;font-size:52px;letter-spacing:4px;line-height:1;}
.tbl{width:100%;border-collapse:collapse;font-size:12px;font-family:'Space Mono',monospace;}
.tbl th{text-align:left;color:#444;letter-spacing:2px;font-weight:400;padding:6px 0;border-bottom:1px solid #1e1e2e;}
.tbl td{padding:8px 0;border-bottom:1px solid #111118;color:#aaa;}
.tbl td:first-child{color:#e8e8e0;}
`;

// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────

function AdminDashboard({ onBack }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    loadAnalytics().then(games => {
      if (!games.length) { setData({ empty: true }); return; }

      const finished = games.filter(g => g.duration);
      const avgDuration = finished.length
        ? finished.reduce((s, g) => s + g.duration, 0) / finished.length : 0;

      const wins = { X: 0, O: 0, draw: 0 };
      games.forEach(g => { if (g.winner) wins[g.winner] = (wins[g.winner]||0) + 1; });

      const withMoves = games.filter(g => g.moves);
      const avgMoves = withMoves.length
        ? (withMoves.reduce((s, g) => s + g.moves, 0) / withMoves.length).toFixed(1) : "—";

      const hourly = Array(24).fill(0);
      games.forEach(g => { if (g.startedAt) hourly[new Date(g.startedAt).getHours()]++; });
      const peakHour = hourly.indexOf(Math.max(...hourly));
      const maxHourly = Math.max(...hourly, 1);

      const daily = {};
      games.forEach(g => {
        if (!g.startedAt) return;
        const d = new Date(g.startedAt).toLocaleDateString("en-US", { weekday: "short" });
        daily[d] = (daily[d]||0) + 1;
      });
      const dayOrder = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const dailySorted = dayOrder.map(d => ({ d, v: daily[d]||0 }));
      const maxDaily = Math.max(...dailySorted.map(x => x.v), 1);

      const playerWins = {};
      const playerGames = {};
      games.forEach(g => {
        [g.creatorName, g.joinerName].filter(Boolean).forEach(p => {
          playerGames[p] = (playerGames[p]||0) + 1;
        });
        if (g.winner === "X" && g.creatorName) playerWins[g.creatorName] = (playerWins[g.creatorName]||0) + 1;
        if (g.winner === "O" && g.joinerName)  playerWins[g.joinerName]  = (playerWins[g.joinerName]||0)  + 1;
      });
      const leaderboard = Object.entries(playerGames)
        .map(([name, gamesPlayed]) => ({ name, gamesPlayed, wins: playerWins[name]||0 }))
        .sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed)
        .slice(0, 10);

      setData({ total: games.length, avgDuration, avgMoves, wins, hourly, peakHour, maxHourly, dailySorted, maxDaily, leaderboard });
    });
  }, []);

  const muted = { color: "#555", fontSize: 11, letterSpacing: 2, fontFamily: "'Space Mono',monospace" };

  if (!data) return <div style={{ color:"#444", fontFamily:"'Space Mono',monospace", padding:40 }}>Loading…</div>;
  if (data.empty) return (
    <div style={{ textAlign:"center", padding:60 }}>
      <div className="ttl" style={{ fontSize:36, color:"#333", marginBottom:12 }}>NO DATA YET</div>
      <div style={muted}>Play some games first.</div>
      <div style={{ marginTop:32 }}><button className="btn" onClick={onBack}>← Back</button></div>
    </div>
  );

  const totalWins = data.wins.X + data.wins.O + data.wins.draw;

  return (
    <div className="fade" style={{ maxWidth:640, width:"100%", padding:"0 16px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:32 }}>
        <div>
          <div className="ttl" style={{ fontSize:44, color:"#e8e8e0" }}>ANALYTICS</div>
          <div style={muted}>Admin · this device only</div>
        </div>
        <button className="btn" onClick={onBack}>← Back</button>
      </div>

      {/* top stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:14 }}>
        {[
          { label:"Total Games", val: data.total },
          { label:"Avg Duration", val: fmtDuration(data.avgDuration) },
          { label:"Avg Moves", val: data.avgMoves },
        ].map(({ label, val }) => (
          <div className="admin-card" key={label} style={{ marginBottom:0 }}>
            <div className="label">{label}</div>
            <div className="stat-big" style={{ color:"#e8e8e0" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* win rates */}
      <div className="admin-card">
        <div className="label" style={{ marginBottom:16 }}>Win Breakdown</div>
        {[
          { label:"X wins", val: data.wins.X, color:"#ff4d5a" },
          { label:"O wins", val: data.wins.O, color:"#4de8ff" },
          { label:"Draws",  val: data.wins.draw, color:"#555" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <div style={{ width:56, fontSize:11, letterSpacing:1, color:"#666", fontFamily:"'Space Mono',monospace" }}>{label}</div>
            <div className="bar-wrap">
              <div className="bar" style={{ width: totalWins ? `${val/totalWins*100}%` : "0%", background: color }} />
            </div>
            <div style={{ width:28, textAlign:"right", fontSize:12, color:"#aaa", fontFamily:"'Space Mono',monospace" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* hourly heatmap */}
      <div className="admin-card">
        <div className="label" style={{ marginBottom:4 }}>Activity by Hour</div>
        <div style={{ color:"#555", fontSize:10, letterSpacing:1, fontFamily:"'Space Mono',monospace", marginBottom:16 }}>
          Peak: {fmtHour(data.peakHour)} ({data.hourly[data.peakHour]} games)
        </div>
        <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:60 }}>
          {data.hourly.map((v, h) => (
            <div key={h} title={`${fmtHour(h)}: ${v}`} style={{
              flex:1,
              height:`${Math.max(4, (v/data.maxHourly)*100)}%`,
              background: h === data.peakHour ? "#4de8ff" : v > 0 ? "#2a3a4a" : "#1a1a2a",
              borderRadius:"1px 1px 0 0", cursor:"default",
            }} />
          ))}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          {["12AM","6AM","12PM","6PM","11PM"].map(t => (
            <div key={t} style={{ fontSize:9, color:"#333", fontFamily:"'Space Mono',monospace" }}>{t}</div>
          ))}
        </div>
      </div>

      {/* daily */}
      <div className="admin-card">
        <div className="label" style={{ marginBottom:16 }}>Activity by Day</div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", height:80 }}>
          {data.dailySorted.map(({ d, v }) => (
            <div key={d} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
              <div style={{ fontSize:9, color:"#555", fontFamily:"'Space Mono',monospace" }}>{v}</div>
              <div style={{
                width:"100%",
                height:`${Math.max(4, (v/data.maxDaily)*56)}px`,
                background: v === data.maxDaily && v > 0 ? "#ff4d5a" : v > 0 ? "#2a2a3a" : "#111118",
                borderRadius:"2px 2px 0 0",
              }} />
              <div style={{ fontSize:9, color:"#444", fontFamily:"'Space Mono',monospace" }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* leaderboard */}
      <div className="admin-card">
        <div className="label" style={{ marginBottom:16 }}>Player Leaderboard · Top Wins</div>
        {data.leaderboard.length === 0 ? (
          <div style={{ color:"#444", fontSize:12, fontFamily:"'Space Mono',monospace" }}>No named players yet.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th><th>Player</th><th>Wins</th><th>Games</th><th>Win %</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((p, i) => (
                <tr key={p.name}>
                  <td style={{ color: i === 0 ? "#ff4d5a" : "#555" }}>{i+1}</td>
                  <td>{p.name}</td>
                  <td style={{ color:"#4de8ff" }}>{p.wins}</td>
                  <td>{p.gamesPlayed}</td>
                  <td>{p.gamesPlayed ? `${Math.round(p.wins/p.gamesPlayed*100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────

export default function TicTacToe() {
  const [screen, setScreen] = useState("home");
  const [mySymbol, setMySymbol] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [myName, setMyName] = useState("");
  const [gameState, setGameState] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [gridSize, setGridSize] = useState(3); // Creator can choose 3, 4, or 5
  const gameStartRef = useRef(null);
  const analyticsRecorded = useRef(false);

  // secret admin: type "admin" on home screen
  const adminBuf = useRef("");
  useEffect(() => {
    const onKey = (e) => {
      if (screen !== "home") return;
      adminBuf.current += e.key.toLowerCase();
      if (adminBuf.current.endsWith("admin")) setScreen("admin");
      if (adminBuf.current.length > 10) adminBuf.current = adminBuf.current.slice(-10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Close the peer connection on unmount
  useEffect(() => () => closeRoom(), []);

  const handleRemoteState = useCallback((state) => {
    setGameState(state);
    setOpponentLeft(false);
  }, []);
  const handleStatus = useCallback((status) => {
    if (status === "left") setOpponentLeft(true);
  }, []);

  useEffect(() => {
    if (gameState && screen === "waiting" && gameState.players === 2) {
      gameStartRef.current = Date.now();
      setScreen("game");
    }
  }, [gameState, screen]);

  // track analytics when game ends
  useEffect(() => {
    if (!gameState?.result || analyticsRecorded.current) return;
    analyticsRecorded.current = true;
    const duration = gameStartRef.current ? Date.now() - gameStartRef.current : null;
    appendAnalytic({
      creatorName: gameState.creatorName || null,
      joinerName:  gameState.joinerName  || null,
      winner:      gameState.result.winner,
      moves:       gameState.moves || 0,
      duration,
      startedAt:   gameState.startedAt || null,
    });
  }, [gameState?.result]);

  const createGame = async () => {
    if (!myName.trim()) { setError("Enter your name first."); return; }
    setLoading(true); setError("");
    const totalCells = gridSize * gridSize;
    let code, initState;
    try {
      for (let attempt = 0; ; attempt++) {
        code = generateCode();
        initState = {
          board: Array(totalCells).fill(""), turn: "X", players: 1, result: null,
          creatorName: myName.trim(), joinerName: null, moves: 0, startedAt: null,
          gridSize: gridSize, lastStarter: "X", scoreX: 0, scoreO: 0,
        };
        try {
          await hostRoom(code, initState, { onState: handleRemoteState, onStatus: handleStatus });
          break;
        } catch (e) {
          // Room code already taken on the broker → try another one
          if (e?.type !== "unavailable-id" || attempt >= 4) throw e;
        }
      }
    } catch {
      setError("Couldn't reach the connection service. Check your internet and try again.");
      setLoading(false);
      return;
    }
    setRoomCode(code);
    setMySymbol("X");
    setGameState(initState);
    setOpponentLeft(false);
    analyticsRecorded.current = false;
    setScreen("waiting");
    setLoading(false);
  };

  const joinGame = async () => {
    if (!myName.trim()) { setError("Enter your name first."); return; }
    if (!inputCode.trim()) { setError("Enter a room code."); return; }
    setLoading(true); setError("");
    const code = inputCode.trim().toUpperCase();
    try {
      const state = await joinRoom(code, myName.trim(), { onState: handleRemoteState, onStatus: handleStatus });
      setRoomCode(code);
      setMySymbol("O");
      setGameState(state);
      setOpponentLeft(false);
      analyticsRecorded.current = false;
      gameStartRef.current = Date.now();
      setScreen("game");
    } catch (e) {
      const msgs = {
        "not-found": "Room not found.",
        "full": "Room is full!",
        "timeout": "Couldn't connect. Check the code, make sure the host's tab is still open, and try again.",
      };
      setError(msgs[e.message] || "Connection failed. Check your internet and try again.");
    }
    setLoading(false);
  };

  const makeMove = async (idx) => {
    if (!gameState || gameState.result || gameState.turn !== mySymbol || gameState.board[idx]) return;
    const newBoard = [...gameState.board];
    newBoard[idx] = mySymbol;
    const currentGridSize = gameState.gridSize || 3;
    const result = checkWinner(newBoard, currentGridSize);
    
    // Update scores if game ended
    let newScoreX = gameState.scoreX || 0;
    let newScoreO = gameState.scoreO || 0;
    if (result && result.winner === "X") newScoreX++;
    if (result && result.winner === "O") newScoreO++;
    
    const updated = {
      ...gameState, board: newBoard,
      turn: mySymbol === "X" ? "O" : "X",
      result: result || null,
      moves: (gameState.moves || 0) + 1,
      scoreX: newScoreX,
      scoreO: newScoreO,
    };
    setGameState(updated);
    if (!sendState(updated)) setOpponentLeft(true);
  };

  const resetGame = async () => {
    analyticsRecorded.current = false;
    gameStartRef.current = Date.now();
    const currentGridSize = gameState.gridSize || 3;
    const totalCells = currentGridSize * currentGridSize;
    // Alternate starter: if last starter was X, now O starts
    const nextStarter = gameState.lastStarter === "X" ? "O" : "X";
    const fresh = {
      board: Array(totalCells).fill(""), turn: nextStarter, players: 2, result: null,
      creatorName: gameState.creatorName, joinerName: gameState.joinerName,
      moves: 0, startedAt: new Date().toISOString(),
      gridSize: currentGridSize, lastStarter: nextStarter,
      scoreX: gameState.scoreX || 0, scoreO: gameState.scoreO || 0,
    };
    setGameState(fresh);
    if (!sendState(fresh)) setOpponentLeft(true);
  };

  const leaveGame = () => {
    closeRoom();
    setOpponentLeft(false);
    setScreen("home"); setGameState(null); setRoomCode("");
    setMySymbol(null); setInputCode(""); setError(""); setMyName("");
    analyticsRecorded.current = false;
  };

  // ── render ──────────────────────────────────────────────────────────────────

  const muted = { fontSize:11, letterSpacing:2, color:"#555", fontFamily:"'Space Mono',monospace" };
  const winLine = gameState?.result?.line || [];

  return (
    <div style={{
      minHeight:"100vh", background:"#0a0a0f", display:"flex",
      alignItems:"center", justifyContent:"center",
      fontFamily:"'Space Mono',monospace", color:"#e8e8e0", padding:20,
    }}>
      <style>{CSS}</style>

      {/* ADMIN */}
      {screen === "admin" && <AdminDashboard onBack={() => setScreen("home")} />}

      {/* HOME */}
      {screen === "home" && (
        <div className="fade" style={{ textAlign:"center", width:"100%", maxWidth:360 }}>
          <div 
            className="ttl" 
            style={{ fontSize:70, lineHeight:1, marginBottom:4, cursor:"default" }}
            onDoubleClick={() => setScreen("admin")}
            title="Double-click for admin"
          >
            TIC<br/>TAC<br/>TOE
          </div>
          <div style={{ ...muted, marginBottom:36 }}>MULTIPLAYER</div>

          <div style={{ marginBottom:20, textAlign:"left" }}>
            <div className="label">Your Name</div>
            <input
              className="inp"
              placeholder="Enter your name…"
              value={myName}
              onChange={e => { setMyName(e.target.value); setError(""); }}
              maxLength={20}
              onKeyDown={e => e.key === "Enter" && createGame()}
            />
          </div>

          <div style={{ marginBottom:20, textAlign:"left" }}>
            <div className="label">Grid Size</div>
            <div style={{ display:"flex", gap:8 }}>
              {[3, 4, 5].map(size => (
                <button
                  key={size}
                  className={`btn${gridSize === size ? " btn-cyan" : ""}`}
                  style={{ flex:1, padding:"10px 0" }}
                  onClick={() => setGridSize(size)}
                >
                  {size}×{size}
                </button>
              ))}
            </div>
            <div style={{ ...muted, fontSize:9, marginTop:6 }}>
              {gridSize >= 5 ? "4-in-a-row to win" : `${gridSize}-in-a-row to win`}
            </div>
          </div>

          <button className="btn" style={{ width:"100%", marginBottom:24 }} onClick={createGame} disabled={loading}>
            {loading ? "Creating…" : "Create Game"}
          </button>

          <div style={{ ...muted, marginBottom:20 }}>— or join with a code —</div>

          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <input
              className="inp code-inp"
              placeholder="XXXXX"
              value={inputCode}
              onChange={e => { setInputCode(e.target.value); setError(""); }}
              maxLength={5}
              onKeyDown={e => e.key === "Enter" && joinGame()}
            />
            <button className="btn btn-cyan" onClick={joinGame} disabled={loading || !inputCode.trim()}>
              {loading ? "…" : "Join"}
            </button>
          </div>

          {error && <div style={{ color:"#ff4d5a", fontSize:12, letterSpacing:1, marginTop:8 }}>{error}</div>}
          {/* <div style={{ ...muted, marginTop:40, fontSize:9 }}>Type <em>admin</em> to access the dashboard</div> */}
        </div>
      )}

      {/* WAITING */}
      {screen === "waiting" && (
        <div className="fade" style={{ textAlign:"center" }}>
          <div style={muted}>Room Code</div>
          <div className="ttl" style={{ fontSize:88, letterSpacing:14, margin:"8px 0 20px" }}>{roomCode}</div>
          <div style={{ ...muted, marginBottom:6 }}>Share this code with your opponent</div>
          <div className="blink" style={{ ...muted, marginBottom:28 }}>Waiting for opponent…</div>
          <div style={{ marginBottom:16 }}>
            <span style={{ fontSize:12, color:"#888", letterSpacing:2 }}>
              You are <span style={{ color:"#ff4d5a" }}>{myName}</span> — playing <span style={{ color:"#ff4d5a" }}>X</span>
            </span>
          </div>
          <div style={{ ...muted, marginBottom:32 }}>
            Grid: {gameState?.gridSize || 3}×{gameState?.gridSize || 3}
          </div>
          <button className="btn btn-red" onClick={leaveGame}>Leave</button>
        </div>
      )}

      {/* GAME */}
      {screen === "game" && gameState && (() => {
        const currentGridSize = gameState.gridSize || 3;
        const cellSize = currentGridSize === 3 ? 100 : currentGridSize === 4 ? 80 : 64;
        const fontSize = currentGridSize === 3 ? 54 : currentGridSize === 4 ? 40 : 32;
        const totalCells = currentGridSize * currentGridSize;
        
        return (
        <div className="fade" style={{ textAlign:"center" }}>
          {opponentLeft && (
            <div style={{ color:"#ff4d5a", fontSize:11, letterSpacing:2, marginBottom:14 }}>
              OPPONENT DISCONNECTED{mySymbol === "X" ? " — THEY CAN REJOIN WITH THE SAME CODE" : ""}
            </div>
          )}

          {/* Score Display */}
          <div style={{ 
            display:"flex", justifyContent:"center", gap:24, marginBottom:20,
            padding:"12px 24px", background:"#111118", border:"1px solid #1e1e2e"
          }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, letterSpacing:2, color:"#666", marginBottom:4 }}>SCORE</div>
              <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                <div>
                  <span style={{ color:"#ff4d5a", fontFamily:"'Bebas Neue',sans-serif", fontSize:32 }}>
                    {gameState.scoreX || 0}
                  </span>
                  <span style={{ color:"#555", fontSize:10, marginLeft:4 }}>X</span>
                </div>
                <div style={{ color:"#333", fontSize:20 }}>—</div>
                <div>
                  <span style={{ color:"#555", fontSize:10, marginRight:4 }}>O</span>
                  <span style={{ color:"#4de8ff", fontFamily:"'Bebas Neue',sans-serif", fontSize:32 }}>
                    {gameState.scoreO || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* player names */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", width: Math.max(320, currentGridSize * cellSize + 20), marginBottom:18 }}>
            <div style={{ textAlign:"left" }}>
              <div className="label">X · {gameState.creatorName || "Player 1"}</div>
              <div style={{
                fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:3,
                color: mySymbol === "X" ? "#ff4d5a" : "#555",
              }}>
                {mySymbol === "X" ? "YOU" : (gameState.creatorName || "P1")}
              </div>
            </div>

            <div style={{ textAlign:"center" }}>
              {!gameState.result ? (
                <>
                  <div className="label">Turn</div>
                  <div style={{
                    fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:3,
                    color: gameState.turn === mySymbol ? "#e8e8e0" : "#333",
                  }}>
                    {gameState.turn === mySymbol ? "YOURS" : "THEIRS"}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, color:"#333", letterSpacing:2 }}>GAME OVER</div>
              )}
            </div>

            <div style={{ textAlign:"right" }}>
              <div className="label">O · {gameState.joinerName || "Player 2"}</div>
              <div style={{
                fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:3,
                color: mySymbol === "O" ? "#4de8ff" : "#555",
              }}>
                {mySymbol === "O" ? "YOU" : (gameState.joinerName || "P2")}
              </div>
            </div>
          </div>

          <div style={{ ...muted, fontSize:9, marginBottom:16 }}>ROOM · {roomCode} · {currentGridSize}×{currentGridSize}</div>

          {/* Board */}
          <div style={{
            display:"grid", 
            gridTemplateColumns:`repeat(${currentGridSize},${cellSize}px)`,
            gridTemplateRows:`repeat(${currentGridSize},${cellSize}px)`, 
            border:"2px solid #1e1e2e", marginBottom:22,
          }}>
            {Array(totalCells).fill(0).map((_, i) => {
              const b1 = "1px solid #1e1e2e";
              return (
                <button
                  key={i}
                  className={`cell${gameState.board[i] ? ` ${gameState.board[i]}` : ""}${winLine.includes(i) ? " win" : ""}`}
                  style={{
                    width: cellSize, height: cellSize, fontSize: fontSize,
                    borderTop:    i < currentGridSize ? "none" : b1,
                    borderLeft:   i % currentGridSize === 0 ? "none" : b1,
                    borderRight:"none", borderBottom:"none",
                  }}
                  onClick={() => makeMove(i)}
                  disabled={!!gameState.board[i] || gameState.turn !== mySymbol || !!gameState.result}
                >
                  {gameState.board[i]}
                </button>
              );
            })}
          </div>

          {/* Result */}
          {gameState.result && (
            <div style={{ marginBottom:20 }}>
              {gameState.result.winner === "draw" ? (
                <div className="ttl" style={{ fontSize:36, color:"#666", letterSpacing:6 }}>DRAW</div>
              ) : gameState.result.winner === mySymbol ? (
                <div className="ttl" style={{ fontSize:40, color:"#4de8ff", letterSpacing:6 }}>YOU WIN 🎉</div>
              ) : (
                <div className="ttl" style={{ fontSize:40, color:"#ff4d5a", letterSpacing:6 }}>YOU LOSE</div>
              )}
              {gameState.moves > 0 && (
                <div style={{ ...muted, marginTop:8 }}>{gameState.moves} moves played</div>
              )}
            </div>
          )}

          <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
            {gameState.result && <button className="btn" onClick={resetGame}>Play Again</button>}
            <button className="btn btn-red" onClick={leaveGame}>Leave</button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
