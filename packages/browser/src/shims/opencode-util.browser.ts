// Stub for @opencode-ai/util
export namespace NamedError {
  export class Unknown extends Error {
    name = "Unknown"
    data: any
    constructor(data: any) {
      super(data?.message || "Unknown error")
      this.data = data
    }
    toObject() {
      return { name: this.name, data: this.data }
    }
  }

  export function create(name: string, schema: any) {
    return class extends Error {
      name = name
      data: any
      constructor(data: any) {
        super(data?.message || name)
        this.data = data
      }
      toObject() {
        return { name: this.name, data: this.data }
      }
    }
  }
}

export default { NamedError }
