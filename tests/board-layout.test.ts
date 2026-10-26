import { describe, it, expect } from 'vitest';
import { BoardLayout, BOARD_PAD, CELL_SIZE } from '../src/board-layout';

describe('responsive board coordinates', () => {
  it('maps every visible cell center back to the same game index on desktop and phone', () => {
    for (const square of [false, true]) {
      const layout = new BoardLayout(square);
      for (let i = 0; i < 56; i++) {
        const { x, y } = layout.center(i);
        expect(layout.cellAt(x, y)).toBe(i);
        expect(layout.cellAt(x + CELL_SIZE / 2 - .01, y + layout.rowHeight / 2 - .01)).toBe(i);
      }
    }
  });
  it('excludes the decorative border and rejects points outside all four edges', () => {
    for (const square of [false, true]) {
      const layout = new BoardLayout(square);
      for (const [x, y] of [[BOARD_PAD - .01, 50], [50, BOARD_PAD - .01], [layout.width - BOARD_PAD, 50], [50, layout.height - BOARD_PAD], [-10, -10]]) expect(layout.cellAt(x, y)).toBeNull();
      expect(layout.cellAt(layout.width - BOARD_PAD - .01, layout.height - BOARD_PAD - .01)).toBe(55);
    }
  });
  it('changes only display geometry when crossing the mobile breakpoint', () => {
    const layout = new BoardLayout();
    expect(layout.width).toBe(744); expect(layout.height).toBe(654); expect(layout.rowHeight).toBe(90);
    layout.square = true;
    expect(layout.height).toBe(layout.width); expect(layout.center(55).y).toBeGreaterThan(650);
    layout.square = false;
    const { x, y } = layout.center(55);
    expect(layout.height).toBe(654); expect(layout.cellAt(x, y)).toBe(55);
  });
});
