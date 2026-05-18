import { ProgressTracker } from '../../utils/progressTracker';
import { ImageQuantizerYieldValue } from '../imageQuantizerYieldValue';

enum Direction {
  NONE = 0,
  UP,
  LEFT,
  RIGHT,
  DOWN,
}

interface Data {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  index: number;
  tracker: ProgressTracker;
  callback(x: number, y: number): void;
}

export function* hilbertCurve(
  width: number,
  height: number,
  callback: (x: number, y: number) => void,
) {
  const maxBound = Math.max(width, height);
  const level = Math.floor(Math.log(maxBound) / Math.log(2) + 1);
  const tracker = new ProgressTracker(width * height, 99);
  const data = {
    width,
    height,
    level,
    callback,
    tracker,
    index: 0,
    x: 0,
    y: 0,
  };
  yield* walkHilbert(data, Direction.UP);
  visit(data, Direction.NONE);
}

function* walkHilbert(
  data: Data,
  direction: Direction,
): IterableIterator<ImageQuantizerYieldValue> {
  if (data.level < 1) return;

  if (data.tracker.shouldNotify(data.index)) {
    yield { progress: data.tracker.progress };
  }
  data.level--;
  switch (direction) {
    case Direction.LEFT:
      yield* walkHilbert(data, Direction.UP);
      visit(data, Direction.RIGHT);
      yield* walkHilbert(data, Direction.LEFT);
      visit(data, Direction.DOWN);
      yield* walkHilbert(data, Direction.LEFT);
      visit(data, Direction.LEFT);
      yield* walkHilbert(data, Direction.DOWN);
      break;

    case Direction.RIGHT:
      yield* walkHilbert(data, Direction.DOWN);
      visit(data, Direction.LEFT);
      yield* walkHilbert(data, Direction.RIGHT);
      visit(data, Direction.UP);
      yield* walkHilbert(data, Direction.RIGHT);
      visit(data, Direction.RIGHT);
      yield* walkHilbert(data, Direction.UP);
      break;

    case Direction.UP:
      yield* walkHilbert(data, Direction.LEFT);
      visit(data, Direction.DOWN);
      yield* walkHilbert(data, Direction.UP);
      visit(data, Direction.RIGHT);
      yield* walkHilbert(data, Direction.UP);
      visit(data, Direction.UP);
      yield* walkHilbert(data, Direction.RIGHT);
      break;

    case Direction.DOWN:
      yield* walkHilbert(data, Direction.RIGHT);
      visit(data, Direction.UP);
      yield* walkHilbert(data, Direction.DOWN);
      visit(data, Direction.LEFT);
      yield* walkHilbert(data, Direction.DOWN);
      visit(data, Direction.DOWN);
      yield* walkHilbert(data, Direction.LEFT);
      break;

    default:
      break;
  }
  data.level++;
}

function visit(data: Data, direction: Direction) {
  if (
    data.x >= 0 &&
    data.x < data.width &&
    data.y >= 0 &&
    data.y < data.height
  ) {
    data.callback(data.x, data.y);
    data.index++;
  }
  switch (direction) {
    case Direction.LEFT:
      data.x--;
      break;
    case Direction.RIGHT:
      data.x++;
      break;
    case Direction.UP:
      data.y--;
      break;
    case Direction.DOWN:
      data.y++;
      break;
  }
}
