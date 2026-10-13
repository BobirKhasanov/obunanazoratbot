// Runs the chess engine off the main thread so the board stays smooth while the computer thinks.
import { Chess } from '/vendor/chess.js';
import { makeEngine } from './ai.mjs';

const engine = makeEngine(Chess);

self.onmessage = (e) => {
  const { id, fen, level, seen, timeMs } = e.data;
  let move = null;
  try {
    move = engine.bestMove(fen, level, { seen, timeMs });
  } catch (err) {
    move = null;
  }
  self.postMessage({ id, move });
};
