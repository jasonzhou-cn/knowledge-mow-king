/** Phaser 的最小替身：只为在 Node 里跑通战斗系统的纯逻辑，不做任何渲染 */
const between = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const floatBetween = (min, max) => Math.random() * (max - min) + min;

const Phaser = {
  Math: { Between: between, FloatBetween: floatBetween },
  GameObjects: { Image: class {} },
  Geom: {
    Rectangle: class {
      constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
      }
      contains(x, y) {
        return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
      }
    },
  },
  Input: { Keyboard: { KeyCodes: {} } },
  Scene: class {},
};

export default Phaser;
