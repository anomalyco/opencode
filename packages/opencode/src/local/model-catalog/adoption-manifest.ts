import { Schema } from "effect"

// Records every substantial llmfit/Skein source adopted into the model catalog:
// which upstream commit it came from, what it became here, and how it was
// changed in transit. A future scout command (model-gallery-ui task 2.5) reads
// `sourceCommit` to report when an entry's upstream source has moved.

export const AdoptionSourceProject = Schema.Literals(["llmfit", "skein"])
export type AdoptionSourceProject = typeof AdoptionSourceProject.Type

export const AdoptionEntry = Schema.Struct({
  sourceProject: AdoptionSourceProject,
  sourceRepository: Schema.String,
  sourceCommit: Schema.String,
  sourceFiles: Schema.Array(Schema.String),
  sourceFunctions: Schema.Array(Schema.String),
  destinationModule: Schema.String,
  transformation: Schema.String,
  tests: Schema.Array(Schema.String),
  license: Schema.NullOr(Schema.String),
  attribution: Schema.NullOr(Schema.String),
})
export type AdoptionEntry = typeof AdoptionEntry.Type

export const LLMFIT_SEED_COMMIT = "12c0edb74b34ad867047c084e5595d3841a08163"
export const SKEIN_SEED_COMMIT = "95f0801a9a27d209f7c1ea1e136d665ac52b89e1"

export const ADOPTION_MANIFEST: readonly AdoptionEntry[] = [
  {
    sourceProject: "llmfit",
    sourceRepository: "https://github.com/AlexsJones/llmfit",
    sourceCommit: "12c0edb74b34ad867047c084e5595d3841a08163",
    sourceFiles: ["llmfit-core/src/models.rs"],
    sourceFunctions: [
      "quant_bpp",
      "quant_bytes_per_param",
      "quant_speed_multiplier",
      "quant_quality_penalty",
      "parse_generation",
      "generation_quality_bonus",
    ],
    destinationModule: "src/local/model-catalog/quant.ts",
    transformation:
      "Rust match expressions translated to lookup tables built from grouped [labels[], value] " +
      "entries; Option<f64>/Rust ownership replaced with nullable numbers and early returns. " +
      "Values and fallback defaults are unchanged. Capability/use-case inference and MoE " +
      "active-parameter estimation from the same source file were not ported: active parameters " +
      "are instead derived directly from Hugging Face's config.num_experts/num_experts_per_tok " +
      "(see huggingface.ts), and capability inference already exists from Hugging Face tags.",
    tests: ["test/local/model-catalog-quant.test.ts"],
    license: "MIT",
    attribution: "https://github.com/AlexsJones/llmfit/blob/main/LICENSE",
  },
  {
    sourceProject: "skein",
    sourceRepository: "https://github.com/androidand/skein.git",
    sourceCommit: "95f0801a9a27d209f7c1ea1e136d665ac52b89e1",
    sourceFiles: ["internal/providers/model_gallery.go", "internal/providers/recommend.go"],
    sourceFunctions: ["modelFamilyVersion", "classifyGallery", "parseRecommendationQuant", "recommendationQuantRank"],
    destinationModule: "src/local/model-catalog/family.ts",
    transformation:
      "Go regexp.FindAllStringSubmatchIndex loop rewritten with String.prototype.matchAll, computing " +
      "the version group's position from match length instead of Go's byte-index capture groups. " +
      "classifyGallery generalized from the concrete Recommendation/installed-file shape into " +
      "classifyByInstalledFamily<T>, parameterized by a nameOf(candidate) accessor, since " +
      "opencode-skein's ModelCandidate has no equivalent AlreadyHave field yet. Context-floor " +
      "selection (bestRecommendationVariant, OptimalCtxSize) was not ported: it depends on live " +
      "VRAM/host capacity data that belongs to the multi-host fit evaluation slice (tasks.md " +
      "section 5), not the catalog domain.",
    tests: ["test/local/model-catalog-family.test.ts"],
    license: null,
    attribution: "private repository, same author/organization as opencode-skein",
  },
]
