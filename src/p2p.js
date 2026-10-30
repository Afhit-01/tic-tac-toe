// Peer-to-peer room layer (WebRTC via PeerJS). No database.
//
// The creator ("host") registers a peer ID derived from the room code. The
// joiner connects straight to it. After the handshake all game data flows
// directly between the two browsers. PeerJS's free public broker is only used
// for that initial handshake; it never stores game state.

import Peer from "peerjs";

const PREFIX = "tictac-ayonaire-";

// ICE servers. STUN alone only works when both networks allow direct paths.
// Mobile data (carrier NAT) and strict routers need a TURN relay, otherwise
// joining times out. Set VITE_TURN_USER / VITE_TURN_PASS (and optionally
// VITE_TURN_HOST) in .env to use your own TURN account (see .env.example).
const TURN_HOST = import.meta.env.VITE_TURN_HOST || "openrelay.metered.ca";
const TURN_USER = import.meta.env.VITE_TURN_USER || "openrelayproject";
const TURN_PASS = import.meta.env.VITE_TURN_PASS || "openrelayproject";

const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: [
          `turn:${TURN_HOST}:80`,
          `turn:${TURN_HOST}:443`,
          `turn:${TURN_HOST}:443?transport=tcp`,
          `turns:${TURN_HOST}:443?transport=tcp`,
        ],
        username: TURN_USER,
        credential: TURN_PASS,
      },
    ],
  },
};

let peer = null;
let conn = null;
let current = null; // latest game state (host uses it to answer joiners)
let session = 0;    // bumped on close so stale callbacks are ignored

export function closeRoom() {
  session++;
  try { conn?.close(); } catch { /* ignore */ }
  try { peer?.destroy(); } catch { /* ignore */ }
  peer = null; conn = null; current = null;
}

// Send the full game state to the opponent. Returns false if not connected.
export function sendState(state) {
  current = state;
  if (conn && conn.open) {
    conn.send({ type: "state", state });
    return true;
  }
  return false;
}

// HOST: create the room. Resolves once the room code is registered.
// Rejects with the PeerJS error (err.type === "unavailable-id" if code is taken).
export function hostRoom(code, initState, { onState, onStatus }) {
  closeRoom();
  const my = session;
  current = initState;

  return new Promise((resolve, reject) => {
    let opened = false;
    const p = new Peer(PREFIX + code, PEER_OPTIONS);
    peer = p;

    p.on("open", () => { opened = true; resolve(); });

    p.on("error", (err) => {
      if (!opened) {
        try { p.destroy(); } catch { /* ignore */ }
        if (peer === p) peer = null;
        reject(err);
      }
    });

    // Lost contact with the broker: reconnect so the room stays joinable.
    p.on("disconnected", () => {
      if (my === session && !p.destroyed) { try { p.reconnect(); } catch { /* ignore */ } }
    });

    p.on("connection", (c) => {
      if (my !== session) return;

      // Someone already connected and still here → room is full.
      if (conn && conn.open) {
        c.on("open", () => {
          c.send({ type: "full" });
          setTimeout(() => { try { c.close(); } catch { /* ignore */ } }, 500);
        });
        return;
      }

      conn = c;

      c.on("data", (msg) => {
        if (my !== session || !msg) return;

        if (msg.type === "join") {
          // New joiner, or the opponent coming back after a drop.
          const updated = current.players >= 2
            ? { ...current, joinerName: msg.name }
            : { ...current, players: 2, joinerName: msg.name, startedAt: new Date().toISOString() };
          current = updated;
          c.send({ type: "state", state: updated });
          onState?.(updated);
        } else if (msg.type === "state") {
          current = msg.state;
          onState?.(msg.state);
        }
      });

      c.on("close", () => {
        if (my !== session || conn !== c) return;
        conn = null;
        onStatus?.("left");
      });
    });
  });
}

// JOINER: connect to a room. Resolves with the initial game state.
// Rejects with Error whose message is "not-found" | "full" | "timeout" | "network".
export function joinRoom(code, name, { onState, onStatus }) {
  closeRoom();
  const my = session;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeRoom();
      reject(new Error(reason));
    };

    timer = setTimeout(() => fail("timeout"), 20000);

    const p = new Peer(undefined, PEER_OPTIONS);
    peer = p;

    p.on("error", (err) => {
      if (my !== session) return;
      fail(err.type === "peer-unavailable" ? "not-found" : "network");
    });

    p.on("open", () => {
      if (my !== session) return;
      const c = p.connect(PREFIX + code, { reliable: true });
      conn = c;

      c.on("open", () => c.send({ type: "join", name }));

      c.on("data", (msg) => {
        if (my !== session || !msg) return;
        if (msg.type === "full") return fail("full");
        if (msg.type === "state") {
          current = msg.state;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(msg.state);
          } else {
            onState?.(msg.state);
          }
        }
      });

      c.on("close", () => {
        if (my !== session) return;
        if (settled) onStatus?.("left");
        else fail("network");
      });
    });
  });
}
