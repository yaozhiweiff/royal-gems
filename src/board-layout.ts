import { COLS, ROWS } from './engine';

export const CELL_SIZE = 90, BOARD_PAD = 12;
export const BOARD_WIDTH = COLS * CELL_SIZE + BOARD_PAD * 2;
export const DESKTOP_HEIGHT = ROWS * CELL_SIZE + BOARD_PAD * 2;

/** View geometry only: the same 8×7 game uses taller touch cells on a square phone board. */
export class BoardLayout {
  constructor(public square = false) {}
  get width() { return BOARD_WIDTH; }
  get height() { return this.square ? BOARD_WIDTH : DESKTOP_HEIGHT; }
  get rowHeight() { return (this.height - BOARD_PAD * 2) / ROWS; }
  center = (i: number) => ({ x: BOARD_PAD + (i % COLS + .5) * CELL_SIZE, y: BOARD_PAD + (Math.floor(i / COLS) + .5) * this.rowHeight });
  cellAt(x: number, y: number) {
    const column = Math.floor((x - BOARD_PAD) / CELL_SIZE), row = Math.floor((y - BOARD_PAD) / this.rowHeight);
    return column >= 0 && column < COLS && row >= 0 && row < ROWS ? row * COLS + column : null;
  }
}
