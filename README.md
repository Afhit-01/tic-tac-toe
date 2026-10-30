# Tic Tac Toe (multiplayer)

Online 2-player tic-tac-toe (3×3, 4×4, 5×5) with room codes. **No database or backend.**

## How it works
- The player who creates a game becomes the host; the room code is their WebRTC peer ID.
- The joiner connects directly to the host's browser (peer-to-peer via [PeerJS](https://peerjs.com)).
  PeerJS's free public broker is used only for the initial handshake and stores nothing.
- Closing the host's tab ends the room. If the opponent drops, they can rejoin with the same code.
- Admin stats (double-click the title) are stored in each browser's `localStorage`, so they only cover games played on that device.

## Run
```
npm install
npm run dev
```

## Playing across different networks (TURN)
Direct WebRTC fails on mobile data and some routers. `src/p2p.js` includes a TURN relay.
By default it uses a public best-effort relay. For reliability, create a free TURN account
and copy `.env.example` to `.env` (also add the same `VITE_TURN_*` variables in your host's
environment settings), then rebuild.
