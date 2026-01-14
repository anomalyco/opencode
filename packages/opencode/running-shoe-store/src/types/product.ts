export interface Product {
  id: string
  name: string
  brand: string
  category: ShoeCategory
  price: number
  description: string
  images: string[]
  sizes: Size[]
  fit: FitInfo
  performance: PerformanceFeatures
  stock: number
  status: "active" | "inactive"
}

export interface Size {
  us: number
  eu: number
  uk: number
  cm: number
  available: boolean
}

export interface FitInfo {
  type: "true-to-size" | "runs-small" | "runs-large"
  width: ("narrow" | "regular" | "wide" | "extra-wide")[]
  recommendedFor: string[]
}

export interface PerformanceFeatures {
  cushioning: "minimal" | "moderate" | "maximum"
  stability: "neutral" | "stability" | "motion-control"
  weight: number
  drop: number
  surface: string[]
}

export type ShoeCategory = "road-running" | "trail-running" | "racing-competition" | "training-daily"

export const BRANDS = [
  "Nike",
  "Adidas",
  "New Balance",
  "ASICS",
  "Brooks",
  "Hoka",
  "Saucony",
  "Mizuno",
  "Under Armour",
  "Puma",
] as const

export const CATEGORIES = {
  "road-running": {
    name: "Road Running",
    description: "Shoes designed for pavement, treadmill, and track surfaces",
    features: ["smooth ride", "durability", "cushioning"],
  },
  "trail-running": {
    name: "Trail Running",
    description: "Off-road shoes with enhanced traction and protection",
    features: ["grip", "rock protection", "durability"],
  },
  "racing-competition": {
    name: "Racing & Competition",
    description: "Lightweight performance shoes for speed work and racing",
    features: ["lightweight", "responsive", "minimal cushioning"],
  },
  "training-daily": {
    name: "Training & Daily",
    description: "Versatile shoes for everyday training and mileage",
    features: ["versatility", "comfort", "durability"],
  },
} as const
