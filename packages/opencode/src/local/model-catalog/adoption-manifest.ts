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
      "section 5), not the catalog domain. " +
      "DELIBERATE DIVERGENCES FROM THE SOURCE (skein fleet-model-gallery task 3.2, validated " +
      "against Skein's exported golden fixtures): two defects present in the Go original are " +
      "fixed here rather than reproduced, because this is the surviving implementation and Skein's " +
      "copy is being retired. (1) recommendationQuantRank ranked only ud_q4_k_m, so UD-Q5_K_M and " +
      "UD-Q8_0 parsed correctly but fell through to unranked and sorted below Q2_K — a ranking " +
      "would have preferred the lowest-quality file over a much better one; both are now ranked at " +
      "their base quant. (2) modelFamilyVersion accepted only '.' as a decimal separator, so " +
      "internlm2_5 and internlm2_6 both truncated to version 2, tied, and made a real point-release " +
      "upgrade vanish from both the upgrade and fresh lists; '_' is now accepted, matching the " +
      "convention quant.ts already uses for the same naming pattern. " +
      "ONE DEFECT IS REPRODUCED ON PURPOSE: an MoE 'NxM' expert-count marker (Mixtral-8x7B vs " +
      "8x22B) is still read as a version, so both tie at 8. A narrow regex fix would relocate the " +
      "corruption rather than remove it — an expert count is not a version, and comparing MoE model " +
      "sizes needs parameter count, which this function does not produce.",
    tests: [
      "test/local/model-catalog-family.test.ts",
      "test/local/model-catalog-golden-parity.test.ts",
      // The golden cases the parity test runs against, copied verbatim from
      // skein:openspec/changes/fleet-model-gallery/fixtures/. Listed
      // individually rather than as a directory so the manifest's own
      // existence check covers them.
      "test/local/fixtures/fleet-model-gallery/quant-cases.json",
      "test/local/fixtures/fleet-model-gallery/family-version-cases.json",
      "test/local/fixtures/fleet-model-gallery/upgrade-fresh-cases.json",
    ],
    license: null,
    attribution: "private repository, same author/organization as opencode-skein",
  },
]
