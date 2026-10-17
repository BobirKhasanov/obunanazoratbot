// Shared piece-set / board-theme picker UI (profile + admin).
import { h } from './ui.js';
import { t } from './i18n.js';
import { PIECE_SETS, BOARD_THEMES, BOARD_SWATCH, DEFAULT_PIECE_SET, pieceSvg } from './pieces.js';

/** Checkerboard CSS baked into the style attribute (no child nodes / CSS vars). */
export function boardSwatchCss(sw) {
  const a = sw.lt;
  const b = sw.dk;
  return [
    `background-color:${a}`,
    `background-image:linear-gradient(${a},${a}),linear-gradient(${b},${b}),linear-gradient(${b},${b}),linear-gradient(${a},${a})`,
    'background-size:50% 50%',
    'background-position:0 0,100% 0,0 100%,100% 100%',
    'background-repeat:no-repeat',
  ].join(';');
}

/** 2×2 preview tile: light/dark squares with sample pieces. */
export function stylePreview(pieceSet, boardTheme) {
  const sw = BOARD_SWATCH[boardTheme] || BOARD_SWATCH.classic;
  const tiles = [
    { bg: sw.lt, c: 'b', t: 'n' },
    { bg: sw.dk, c: 'w', t: 'n' },
    { bg: sw.dk, c: 'w', t: 'k' },
    { bg: sw.lt, c: 'b', t: 'q' },
  ];
  return h('div.style-preview', { 'data-pieces': pieceSet, 'aria-hidden': 'true' },
    tiles.map((x) => h('div.style-preview-sq', {
      style: `background-color:${x.bg}`,
      html: pieceSvg(x.c, x.t, pieceSet),
    })));
}

export function pieceSwatchButtons(selected, { locked, onPick }) {
  return PIECE_SETS.map((id) => h('button.style-opt' + (selected === id ? '.on' : ''), {
    type: 'button',
    'data-pieces': id,
    'aria-label': t('piece_' + id),
    disabled: locked || undefined,
    onclick: () => onPick(id),
  },
    /* Black on light half, white on dark half — readable contrast */
    h('span.style-opt-art', { html: pieceSvg('b', 'n', id) + pieceSvg('w', 'n', id) }),
    h('span.style-opt-lab', t('piece_' + id))));
}

export function boardSwatchButtons(selected, { locked, onPick }) {
  return BOARD_THEMES.map((id) => {
    const sw = BOARD_SWATCH[id];
    return h('button.style-opt.board' + (selected === id ? '.on' : ''), {
      type: 'button',
      'aria-label': t('board_' + id),
      title: t('board_' + id),
      disabled: locked || undefined,
      style: boardSwatchCss(sw),
      onclick: () => onPick(id),
    }, h('span.style-opt-lab', t('board_' + id)));
  });
}

export function stylePickerCard({ pieceSet, boardTheme, locked, onPiece, onBoard }) {
  const piece = pieceSet || DEFAULT_PIECE_SET;
  const board = boardTheme || 'classic';
  return h('div.card.style-card' + (locked ? '.style-lock' : ''),
    stylePreview(piece, board),
    h('div.label', t('piece_set')),
    locked ? h('p.muted', t('style_premium_hint')) : null,
    h('div.style-swatches', pieceSwatchButtons(piece, { locked, onPick: onPiece })),
    h('div.label', t('board_theme')),
    h('div.style-swatches', boardSwatchButtons(board, { locked, onPick: onBoard })));
}

export { PIECE_SETS, BOARD_THEMES, BOARD_SWATCH };
