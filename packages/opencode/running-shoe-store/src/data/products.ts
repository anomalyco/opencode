import type { Product, ShoeCategory } from "../types/product"
import { BRANDS } from "../types/product"

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: "nike-air-zoom-pegasus-40",
    name: "Nike Air Zoom Pegasus 40",
    brand: "Nike",
    category: "training-daily",
    price: 130,
    description: "The legendary Pegasus returns with enhanced cushioning and responsiveness for your daily training.",
    images: ["/products/nike-pegasus-40-1.jpg", "/products/nike-pegasus-40-2.jpg", "/products/nike-pegasus-40-3.jpg"],
    sizes: [
      { us: 7, eu: 40, uk: 6.5, cm: 25, available: true },
      { us: 7.5, eu: 40.5, uk: 7, cm: 25.5, available: true },
      { us: 8, eu: 41, uk: 7.5, cm: 26, available: true },
      { us: 8.5, eu: 42, uk: 8, cm: 26.5, available: true },
      { us: 9, eu: 42.5, uk: 8.5, cm: 27, available: true },
      { us: 9.5, eu: 43, uk: 9, cm: 27.5, available: true },
      { us: 10, eu: 44, uk: 9.5, cm: 28, available: true },
      { us: 10.5, eu: 44.5, uk: 10, cm: 28.5, available: true },
      { us: 11, eu: 45, uk: 10.5, cm: 29, available: true },
      { us: 11.5, eu: 45.5, uk: 11, cm: 29.5, available: true },
      { us: 12, eu: 46, uk: 11.5, cm: 30, available: true },
    ],
    fit: {
      type: "true-to-size",
      width: ["regular", "wide"],
      recommendedFor: ["neutral runners", "daily training", "long distance"],
    },
    performance: {
      cushioning: "moderate",
      stability: "neutral",
      weight: 285,
      drop: 10,
      surface: ["road", "track", "treadmill"],
    },
    stock: 150,
    status: "active",
  },
  {
    id: "adidas-ultraboost-22",
    name: "adidas Ultraboost 22",
    brand: "Adidas",
    category: "road-running",
    price: 190,
    description: "Revolutionary energy return with Boost cushioning for premium comfort on your runs.",
    images: [
      "/products/adidas-ultraboost-22-1.jpg",
      "/products/adidas-ultraboost-22-2.jpg",
      "/products/adidas-ultraboost-22-3.jpg",
    ],
    sizes: [
      { us: 7, eu: 40, uk: 6.5, cm: 25, available: true },
      { us: 7.5, eu: 40.5, uk: 7, cm: 25.5, available: true },
      { us: 8, eu: 41, uk: 7.5, cm: 26, available: true },
      { us: 8.5, eu: 42, uk: 8, cm: 26.5, available: true },
      { us: 9, eu: 42.5, uk: 8.5, cm: 27, available: true },
      { us: 9.5, eu: 43, uk: 9, cm: 27.5, available: true },
      { us: 10, eu: 44, uk: 9.5, cm: 28, available: true },
      { us: 10.5, eu: 44.5, uk: 10, cm: 28.5, available: true },
      { us: 11, eu: 45, uk: 10.5, cm: 29, available: true },
      { us: 11.5, eu: 45.5, uk: 11, cm: 29.5, available: true },
      { us: 12, eu: 46, uk: 11.5, cm: 30, available: true },
    ],
    fit: {
      type: "true-to-size",
      width: ["regular"],
      recommendedFor: ["road runners", "daily training", "recovery runs"],
    },
    performance: {
      cushioning: "maximum",
      stability: "neutral",
      weight: 310,
      drop: 10,
      surface: ["road", "track"],
    },
    stock: 85,
    status: "active",
  },
  {
    id: "hoka-clifton-9",
    name: "Hoka Clifton 9",
    brand: "Hoka",
    category: "training-daily",
    price: 145,
    description: "Maximum cushioning meets lightweight design for the perfect daily trainer.",
    images: ["/products/hoka-clifton-9-1.jpg", "/products/hoka-clifton-9-2.jpg", "/products/hoka-clifton-9-3.jpg"],
    sizes: [
      { us: 7, eu: 40, uk: 6.5, cm: 25, available: true },
      { us: 7.5, eu: 40.5, uk: 7, cm: 25.5, available: true },
      { us: 8, eu: 41, uk: 7.5, cm: 26, available: true },
      { us: 8.5, eu: 42, uk: 8, cm: 26.5, available: true },
      { us: 9, eu: 42.5, uk: 8.5, cm: 27, available: true },
      { us: 9.5, eu: 43, uk: 9, cm: 27.5, available: true },
      { us: 10, eu: 44, uk: 9.5, cm: 28, available: true },
      { us: 10.5, eu: 44.5, uk: 10, cm: 28.5, available: true },
      { us: 11, eu: 45, uk: 10.5, cm: 29, available: true },
      { us: 11.5, eu: 45.5, uk: 11, cm: 29.5, available: true },
      { us: 12, eu: 46, uk: 11.5, cm: 30, available: true },
    ],
    fit: {
      type: "runs-small",
      width: ["regular", "wide"],
      recommendedFor: ["neutral runners", "long distance", "recovery runs"],
    },
    performance: {
      cushioning: "maximum",
      stability: "neutral",
      weight: 290,
      drop: 5,
      surface: ["road", "track"],
    },
    stock: 120,
    status: "active",
  },
  {
    id: "nike-vaporfly-next-3",
    name: "Nike Vaporfly Next% 3",
    brand: "Nike",
    category: "racing-competition",
    price: 275,
    description: "The ultimate racing shoe with carbon fiber plate for record-breaking performance.",
    images: ["/products/nike-vaporfly-3-1.jpg", "/products/nike-vaporfly-3-2.jpg", "/products/nike-vaporfly-3-3.jpg"],
    sizes: [
      { us: 7, eu: 40, uk: 6.5, cm: 25, available: true },
      { us: 7.5, eu: 40.5, uk: 7, cm: 25.5, available: true },
      { us: 8, eu: 41, uk: 7.5, cm: 26, available: true },
      { us: 8.5, eu: 42, uk: 8, cm: 26.5, available: true },
      { us: 9, eu: 42.5, uk: 8.5, cm: 27, available: true },
      { us: 9.5, eu: 43, uk: 9, cm: 27.5, available: true },
      { us: 10, eu: 44, uk: 9.5, cm: 28, available: true },
      { us: 10.5, eu: 44.5, uk: 10, cm: 28.5, available: true },
      { us: 11, eu: 45, uk: 10.5, cm: 29, available: true },
      { us: 11.5, eu: 45.5, uk: 11, cm: 29.5, available: true },
      { us: 12, eu: 46, uk: 11.5, cm: 30, available: true },
    ],
    fit: {
      type: "runs-small",
      width: ["regular"],
      recommendedFor: ["racing", "speed work", "elite runners"],
    },
    performance: {
      cushioning: "moderate",
      stability: "neutral",
      weight: 195,
      drop: 8,
      surface: ["road", "track"],
    },
    stock: 45,
    status: "active",
  },
  {
    id: "salomon-speedcross-5",
    name: "Salomon Speedcross 5",
    brand: "Salomon",
    category: "trail-running",
    price: 160,
    description: "Aggressive grip and protection for technical trail conditions and muddy terrain.",
    images: [
      "/products/salomon-speedcross-5-1.jpg",
      "/products/salomon-speedcross-5-2.jpg",
      "/products/salomon-speedcross-5-3.jpg",
    ],
    sizes: [
      { us: 7, eu: 40, uk: 6.5, cm: 25, available: true },
      { us: 7.5, eu: 40.5, uk: 7, cm: 25.5, available: true },
      { us: 8, eu: 41, uk: 7.5, cm: 26, available: true },
      { us: 8.5, eu: 42, uk: 8, cm: 26.5, available: true },
      { us: 9, eu: 42.5, uk: 8.5, cm: 27, available: true },
      { us: 9.5, eu: 43, uk: 9, cm: 27.5, available: true },
      { us: 10, eu: 44, uk: 9.5, cm: 28, available: true },
      { us: 10.5, eu: 44.5, uk: 10, cm: 28.5, available: true },
      { us: 11, eu: 45, uk: 10.5, cm: 29, available: true },
      { us: 11.5, eu: 45.5, uk: 11, cm: 29.5, available: true },
      { us: 12, eu: 46, uk: 11.5, cm: 30, available: true },
    ],
    fit: {
      type: "true-to-size",
      width: ["regular"],
      recommendedFor: ["trail runners", "muddy conditions", "technical terrain"],
    },
    performance: {
      cushioning: "moderate",
      stability: "neutral",
      weight: 310,
      drop: 9,
      surface: ["trail", "mud", "rock"],
    },
    stock: 75,
    status: "active",
  },
]

export function getProductsByCategory(category: ShoeCategory): Product[] {
  return SAMPLE_PRODUCTS.filter((product) => product.category === category)
}

export function getProductsByBrand(brand: string): Product[] {
  return SAMPLE_PRODUCTS.filter((product) => product.brand === brand)
}

export function searchProducts(query: string): Product[] {
  const lowercaseQuery = query.toLowerCase()
  return SAMPLE_PRODUCTS.filter(
    (product) =>
      product.name.toLowerCase().includes(lowercaseQuery) ||
      product.brand.toLowerCase().includes(lowercaseQuery) ||
      product.description.toLowerCase().includes(lowercaseQuery),
  )
}

export function getProductById(id: string): Product | undefined {
  return SAMPLE_PRODUCTS.find((product) => product.id === id)
}
