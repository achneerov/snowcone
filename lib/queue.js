class Queue {
  #items = [];
  #head = 0;

  enqueue(item) {
    this.#items.push(item);
  }

  dequeue() {
    if (this.isEmpty()) return undefined;

    const item = this.#items[this.#head];
    this.#items[this.#head] = undefined;
    this.#head++;

    if (this.#head === this.#items.length) {
      this.#items = [];
      this.#head = 0;
    } else if (this.#head >= 1024 && this.#head * 2 >= this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }

    return item;
  }

  peek() {
    return this.#items[this.#head];
  }

  get size() {
    return this.#items.length - this.#head;
  }

  isEmpty() {
    return this.size === 0;
  }
}

export default Queue;
