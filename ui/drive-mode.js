/** Modo visual apenas, com histerese: não participa de alertas ou GPS nativo. */
export class DriveModeController {
  constructor({ enterKmh = 12, exitKmh = 4, enterFixes = 3, exitFixes = 5 } = {}) {
    this.enterKmh = enterKmh;
    this.exitKmh = exitKmh;
    this.enterFixes = enterFixes;
    this.exitFixes = exitFixes;
    this.reset();
  }
  update(speedKmh) {
    if (!Number.isFinite(speedKmh)) return this.driving;
    if (this.driving) {
      this.stillCount = speedKmh < this.exitKmh ? this.stillCount + 1 : 0;
      if (this.stillCount >= this.exitFixes) this.reset();
    } else {
      this.movingCount = speedKmh >= this.enterKmh ? this.movingCount + 1 : 0;
      if (this.movingCount >= this.enterFixes) {
        this.driving = true;
        this.movingCount = 0;
        this.stillCount = 0;
      }
    }
    return this.driving;
  }
  reset() { this.driving = false; this.movingCount = 0; this.stillCount = 0; }
}
