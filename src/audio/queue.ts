/**
 * BoundedQueue: A fixed-capacity queue with observable metrics and drop-stale policy.
 * Prevents latency accumulation when AI inference is temporarily slower than incoming audio.
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

  constructor(maxCapacity: number = 2) {
    if (maxCapacity <= 0) {
      throw new Error(`Capacity must be positive: got ${maxCapacity}`);
    }
    this.maxCapacity = maxCapacity;
  }

  /**
   * Enqueue an item. If capacity is exceeded, drops the oldest item to maintain real-time relevance.
   */
  public enqueue(item: T): boolean {
    this.totalEnqueued++;

    if (this.items.length >= this.maxCapacity) {
      this.items.shift();
      this.droppedCount++;
      this.items.push(item);
      return false;
    }

    this.items.push(item);
    return true;
  }

  /**
   * Drain all currently queued items in chronological order and empty the queue.
   */
  public drainAll(): T[] {
    if (this.items.length === 0) return [];
    const all = this.items.splice(0, this.items.length);
    this.totalDequeued += all.length;
    return all;
  }

  public recordDropped(count: number): void {
    this.droppedCount += count;
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

  public getMetrics(): QueueMetrics {
    return {
      currentDepth: this.items.length,
      maxCapacity: this.maxCapacity,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      droppedCount: this.droppedCount,
    };
  }

  public clear(): void {
    this.items.length = 0;
    this.totalEnqueued = 0;
    this.totalDequeued = 0;
    this.droppedCount = 0;
  }
}
