// Minimal browser EventEmitter covering the subset Kando's renderer uses.
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(listener);
    return this;
  }

  addListener(type, listener) {
    return this.on(type, listener);
  }

  once(type, listener) {
    const wrapped = (...args) => {
      this.off(type, wrapped);
      listener.apply(this, args);
    };
    return this.on(type, wrapped);
  }

  off(type, listener) {
    const list = this._listeners.get(type);
    if (!list) return this;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
    return this;
  }

  removeListener(type, listener) {
    return this.off(type, listener);
  }

  removeAllListeners(type) {
    if (type === undefined) this._listeners.clear();
    else this._listeners.delete(type);
    return this;
  }

  emit(type, ...args) {
    const list = this._listeners.get(type);
    if (!list || !list.length) return false;
    for (const listener of [...list]) listener.apply(this, args);
    return true;
  }
}

export default { EventEmitter };
