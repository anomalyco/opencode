export class LocalEmbedder {
  private readonly dimensions: number;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  /**
   * Fast hash function (Murmur3-inspired 32-bit integer hash)
   */
  private hashString(str: string, seed: number = 0): number {
    let h = seed ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    return Math.abs(h);
  }

  /**
   * Arabic & multilingual text normalization
   */
  public normalizeText(text: string): string {
    return text
      .toLowerCase()
      // Normalize Arabic characters
      .replace(/[إأآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F\u0670]/g, '') // Remove tashkeel/diacritics
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Converts any text into a dense normalized Float32Array vector of fixed dimensions
   */
  public embed(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const normalized = this.normalizeText(text);
    if (!normalized) return vector;

    const words = normalized.split(' ').filter(w => w.length > 1);

    // 1. Word token hashing with frequency
    for (const word of words) {
      const idx = this.hashString(word, 42) % this.dimensions;
      const sign = (this.hashString(word, 137) % 2 === 0) ? 1 : -1;
      vector[idx] += sign * 1.5;

      // 2. Character n-grams (3-grams and 4-grams) for robust subword semantics
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.substring(i, i + 3);
        const triIdx = this.hashString(trigram, 99) % this.dimensions;
        const triSign = (this.hashString(trigram, 211) % 2 === 0) ? 1 : -1;
        vector[triIdx] += triSign * 0.5;
      }
    }

    // 3. L2 Unit Normalization (so vector A dot vector B = cosine similarity)
    let sumSquares = 0;
    for (let i = 0; i < this.dimensions; i++) {
      sumSquares += vector[i] * vector[i];
    }

    const norm = Math.sqrt(sumSquares);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * Compute cosine similarity between two normalized vectors
   */
  public static cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) return 0;
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    return Math.max(0, Math.min(1, (dot + 1) / 2)); // Normalize to [0, 1] range
  }
}

export default new LocalEmbedder();
