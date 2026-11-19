/**
 * BoundedQueue: A fixed-capacity queue with observable metrics and drop policy.
 * Prevents memory leaks and backpressure buildup when AI inference is slower than real-time audio.
 */
export interface QueueMetrics {
  currentDepth: number;
  maxCapacity: number;
  totalEnqueued: number;
  totalDequeued: number;
  droppedCount: number;
}

export class BoundedQueue<T> {
  private readonly maxCapacity: number;
  private readonly items: T[] = [];
  private totalEnqueued: number = 0;
  private totalDequeued: number = 0;
  private droppedCount: number = 0;

  constructor(maxCapacity: number = 5) {
    if (maxCapacity <= 0) {
      throw new Error(`Capacity must be positive: got ${maxCapacity}`);
    }
    this.maxCapacity = maxCapacity;
  }

  /**
   * Enqueue an item. If capacity is exceeded, drops the oldest item to maintain real-time relevance.
   * Returns true if queued without dropping, false if an item was dropped.
   */
  public enqueue(item: T): boolean {
    this.totalEnqueued++;

    if (this.items.length >= this.maxCapacity) {
      // Drop oldest chunk
      this.items.shift();
      this.droppedCount++;
      this.items.push(item);
      return false;
    }

    this.items.push(item);
    return true;
  }

  /**
   * Dequeue the next available item, or undefined if empty.
   */
  public dequeue(): T | undefined {
    if (this.items.length === 0) return undefined;
    this.totalDequeued++;
    return this.items.shift();
  }

  /**
   * Peek at the front item without removing it.
   */
  public peek(): T | undefined {
    return this.items[0];
  }

  public get size(): number {
    return this.items.length;
  }

  public get isEmpty(): boolean {
    return this.items.length === 0;
  }

  public get isFull(): boolean {
    return this.items.length >= this.maxCapacity;
  }

  /**
   * Get current queue diagnostic metrics.
   */
  public getMetrics(): QueueMetrics {
    return {
      currentDepth: this.items.length,
      maxCapacity: this.maxCapacity,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      droppedCount: this.droppedCount,
    };
  }

  /**
   * Clear all items and reset metrics.
   */
  public clear(): void {
    this.items.length = 0;
    this.totalEnqueued = 0;
    this.totalDequeued = 0;
    this.droppedCount = 0;
  }
}
