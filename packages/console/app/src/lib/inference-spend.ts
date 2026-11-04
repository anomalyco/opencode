// salesforceValue must match the restricted Lead picklist, independent of translated UI labels.
export const inferenceSpendOptions = [
  { value: "none", salesforceValue: "Not spending yet", key: "enterprise.form.inferenceSpend.none" },
  { value: "under-1k", salesforceValue: "Under $1K", key: "enterprise.form.inferenceSpend.under1k" },
  { value: "1k-10k", salesforceValue: "$1K–$10K", key: "enterprise.form.inferenceSpend.1kTo10k" },
  { value: "10k-50k", salesforceValue: "$10K–$50K", key: "enterprise.form.inferenceSpend.10kTo50k" },
  { value: "50k-100k", salesforceValue: "$50K–$100K", key: "enterprise.form.inferenceSpend.50kTo100k" },
  { value: "over-100k", salesforceValue: "$100K or more", key: "enterprise.form.inferenceSpend.over100k" },
] as const
