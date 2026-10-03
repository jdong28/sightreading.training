// how long a gap between frames may run, while there's no floor, before it
// is dropped rather than played out: requestAnimationFrame stops in a
// hidden tab (and note-ons are dropped while document.hidden), so without
// this the first frame back would scroll every column of the hidden time
// past as misses (D4(c))
const FRAME_GAP_PAUSE_MS = 500

// used to control animation outside of react
export default class SlideToZero {
  constructor(opts={}) {
    this.value = 0;
    this.speed = opts.speed || 1; // 1 unit a second
    this.animating = false;

    this.onUpdate = opts.onUpdate || function() {}
    this.onStop = opts.onStop || function() {}
    this.onStart = opts.onStart || function() {}
    this.onLoop = opts.onLoop || function() {}
    // where the value waits, however long a frame runs past it. Set to
    // null (not through this default, which only fills in an unset opts.floor)
    // for no floor, so the value runs on below it (D4(c))
    this.floor = opts.floor || 0
    // where a looping value loops, instead of at 0 (D4(c), tempo mode's
    // tolerance past the hit line)
    this.passAt = opts.passAt || 0

    if (opts.loopPhase) {
      this.looping = true;
      this.loopPhase = opts.loopPhase;
      this.add(opts.initialValue || this.loopPhase);
    }
  }

  cancel() {
    this.canceled = true
  }

  add(delta) {
    this.value += delta;
    this.checkAndStart();
  }

  checkAndStart() {
    if (this.animating || this.value == this.floor) {
      return
    }

    let lastFrame = null;
    this.animating = true
    this.canceled = false
    this.onStart();
    this.onUpdate(this.value);

    let frameUpdate = time => {
      if (this.canceled) {
        this.animating = false;
        return;
      }

      if (lastFrame === null) {
        lastFrame = time;
        window.requestAnimationFrame(frameUpdate);
        return;
      }

      // with no floor the value runs on indefinitely, so a gap this long
      // (the tab was hidden) is dropped instead of scrolling every column
      // of it past as misses
      if (this.floor == null && time - lastFrame > FRAME_GAP_PAUSE_MS) {
        lastFrame = time;
        window.requestAnimationFrame(frameUpdate);
        return;
      }

      let dt = (time - lastFrame) / 1000;
      lastFrame = time;

      if (dt == 0) {
        window.requestAnimationFrame(frameUpdate);
        return;
      }

      let before = this.value;
      this.value = this.value - this.speed * dt;

      if (this.floor != null && this.value < this.floor) {
        this.value = this.floor;
      }

      if (this.looping) {
        if (this.value <= this.passAt) {
          this.value += this.loopPhase;
          this.onLoop();
        }
      } else {
        this.value = Math.max(0, this.value);
      }

      // a frame the floor held the value through drew the same offset it
      // already stood at, so it moved nothing: told apart from one that
      // slid, as the dropped gap above is (D4(c))
      if (this.value != before) {
        this.onUpdate(this.value);
      }

      // this.value > this.floor is this.value > 0 when floor is null (a
      // JS trap: null coerces to 0 in a comparison), which would stop the
      // animation between 0 and passAt, so no floor never stops it here
      if (this.floor == null || this.value > this.floor) {
        window.requestAnimationFrame(frameUpdate);
      } else {
        this.animating = false;
        this.onStop();
      }
    }

    window.requestAnimationFrame(frameUpdate);
  }
}
