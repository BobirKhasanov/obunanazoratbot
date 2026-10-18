// Small opening book: enough to label the first moves "Book Move" like Chess.com does.
// Each line is SAN moves; a move is "book" while the game still follows some line.
const LINES = [
  ['Italian Game', 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O'],
  ['Italian Game: Two Knights', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5'],
  ['Italian Game: Giuoco Pianissimo', 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 O-O d6 c3 O-O'],
  ['Evans Gambit', 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O'],
  ['Ruy Lopez', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3'],
  ['Ruy Lopez: Berlin', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8'],
  ['Ruy Lopez: Exchange', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4'],
  ['Scotch Game', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6'],
  ['Scotch Game: Classical', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4'],
  ['Petrov Defense', 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6 Re1 Bg4'],
  ['Four Knights Game', 'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7'],
  ['Vienna Game', 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d3 Nxc3 bxc3 O-O'],
  ["King's Gambit", 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6 Bc4 d5 exd5 Bd6'],
  ['Philidor Defense', 'e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O'],
  ['Sicilian Defense: Najdorf', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O'],
  ['Sicilian Defense: Dragon', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O'],
  ['Sicilian Defense: Classical', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Bg5 e6 Qd2 a6 O-O-O Bd7'],
  ['Sicilian Defense: Sveshnikov', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5 Nd5 Be7'],
  ['Sicilian Defense: Scheveningen', 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Be2 Be7 O-O O-O f4 Nc6 Be3 a6'],
  ['Sicilian Defense: Alapin', 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb3 dxe5 Nxe5 Nxe5 dxe5 Qxd1+ Kxd1'],
  ['Sicilian Defense: Closed', 'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6 Qd2 Nge7 Nge2 O-O'],
  ['French Defense: Advance', 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4 Nbd2 Na5 b4 cxb3 Nxb3 Nxb3 Qxb3'],
  ['French Defense: Winawer', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 cxd4 Ne2'],
  ['French Defense: Classical', 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5 Qd2 Nc6 O-O-O'],
  ['French Defense: Tarrasch', 'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6 exf6 Nxf6 O-O Bd6'],
  ['French Defense: Exchange', 'e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O Bg5 Bg4 Nbd2 Nbd7'],
  ['Caro-Kann Defense: Advance', 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Qb6 Nc3 Nc6 O-O Nge7'],
  ['Caro-Kann Defense: Classical', 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6'],
  ['Caro-Kann Defense: Exchange', 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7 Nd2 e6 Ngf3 Bd6'],
  ['Pirc Defense', 'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6 a4 Nbd7 h3 Qc7'],
  ['Modern Defense', 'e4 g6 d4 Bg7 Nc3 d6 Nf3 a6 Be3 b5 Bd3 Nd7 Qd2 Ngf6 O-O'],
  ['Scandinavian Defense', 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Nd5 Qd8'],
  ['Alekhine Defense', 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7 c4 Nb6 Nc3 O-O Be3 d5'],
  ["Queen's Gambit Declined", 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5'],
  ["Queen's Gambit Accepted", 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 Bb3 cxd4 exd4 Nc6'],
  ['Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O Nbd7 Qe2 Bg6'],
  ['Semi-Slav Defense', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 a6 e4 c5'],
  ['London System', 'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3 b6 Ne5'],
  ['Colle System', 'd4 d5 Nf3 Nf6 e3 e6 Bd3 c5 c3 Nc6 Nbd2 Bd6 O-O O-O dxc5 Bxc5 e4'],
  ['Trompowsky Attack', 'd4 Nf6 Bg5 Ne4 Bf4 c5 f3 Qa5+ c3 Nf6 dxc5 e6 e4 Bxc5 Nd2 Nc6'],
  ["King's Indian Defense", 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Be3 f5'],
  ["King's Indian: Fianchetto", 'd4 Nf6 c4 g6 g3 Bg7 Bg2 O-O Nc3 d6 Nf3 Nbd7 O-O e5 e4 c6 h3 Qb6'],
  ['Grünfeld Defense', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Rb1 O-O Be2 cxd4 cxd4 Qa5+'],
  ['Nimzo-Indian Defense', 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4 Bxc4 Qc7'],
  ["Queen's Indian Defense", 'd4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6 Bc3 d5 Ne5 Nfd7'],
  ['Catalan Opening', 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5 Qc2 Bb7 Bd2'],
  ['Benoni Defense', 'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O Re8 Nd2 Na6'],
  ['Dutch Defense', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6 Nc3 Qe8 Re1 Qh5 e4 fxe4 Nxe4 Nxe4 Rxe4'],
  ['English Opening', 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O a3 Be6'],
  ['English Opening: Symmetrical', 'c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 e6 O-O Nge7 d3 O-O a3 d5 cxd5 exd5'],
  ['Réti Opening', 'Nf3 d5 c4 d4 b4 c5 bxc5 e6 e3 Bxc5 exd4 Bxd4 Nxd4 Qxd4 Nc3 Ne7 d3 Nbc6 Bb2 Qe5'],
  ["Réti: King's Indian Attack", 'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b5 e5 Nd7 Nf1 Bb7'],
  ['Bird Opening', 'f4 d5 Nf3 Nf6 e3 g6 Be2 Bg7 O-O O-O d3 c5 Qe1 Nc6 Nc3 d4 Ne4 Nxe4 dxe4 e5'],
  ['Larsen Opening', 'b3 e5 Bb2 Nc6 e3 d5 Bb5 Bd6 f4 Qh4+ g3 Qe7 Nf3 f6 Bxc6+ bxc6 Ne5'],
  ['Sokolsky Opening', 'b4 e5 Bb2 Bxb4 Bxe5 Nf6 Bxf6 Qxf6 c3 Be7 e4 d6 d4 O-O Nf3 Nc6 Bd3 Bg4'],
  ["Zukertort Opening", 'Nf3 Nf6 g3 g6 Bg2 Bg7 O-O O-O d3 d6 c4 c5 Nc3 Nc6 Bd2 Rb8 Rb1 a6'],
];

const book = new Map();
for (const [name, line] of LINES) {
  const mv = line.split(' ');
  let node = book;
  for (let i = 0; i < mv.length; i++) {
    const k = mv[i];
    if (!node.has(k)) node.set(k, { next: new Map(), name });
    const e = node.get(k);
    e.name = e.name || name; // first line to claim a node names it
    node = e.next;
  }
}

/**
 * How many leading plies of `sans` are book, and the opening name (name of the last book node).
 * Transposed move orders are not detected — only lines as listed.
 */
export function bookInfo(sans) {
  let node = book; let plies = 0; let name = '';
  for (const raw of sans) {
    const san = String(raw).replace(/[+#!?]/g, '');
    let hit = node.get(san);
    if (!hit) {
      for (const [k, v] of node) if (k.replace(/[+#]/g, '') === san) { hit = v; break; }
    }
    if (!hit) break;
    plies++; name = hit.name; node = hit.next;
    if (plies >= 16) break;
  }
  return { plies, name };
}
