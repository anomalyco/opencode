export class ProgressTracker {
  static readonly steps = 100;

  progress: number;

  private _step: number;
  private _range: number;
  private _last: number;
  private _progressRange: number;

  constructor(valueRange: number, progressRange: number) {
    this._range = valueRange;
    this._progressRange = progressRange;
    this._step = Math.max(1, (this._range / (ProgressTracker.steps + 1)) | 0);
    this._last = -this._step;
    this.progress = 0;
  }

  shouldNotify(current: number) {
    if (current - this._last >= this._step) {
      this._last = current;
      this.progress = Math.min(
        (this._progressRange * this._last) / this._range,
        this._progressRange,
      );
      return true;
    }

    return false;
  }
}
