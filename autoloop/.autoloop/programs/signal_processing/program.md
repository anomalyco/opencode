# Program: signal_processing

## Goal

Design a digital filter that removes noise from a signal while preserving the
underlying clean waveform. The filter lives in `code/filter.py` as
`apply_filter(samples)`. A weak moving-average baseline is provided.

The test signal is a sum of two sine waves corrupted by additive Gaussian noise.
A good filter maximizes the signal-to-noise ratio of the reconstruction against
the known clean signal.

## Target metric

`score = snr_db` — the signal-to-noise ratio, in decibels, of
`apply_filter(noisy)` versus the ground-truth clean signal.

Higher is better. The baseline scores roughly `10-13 dB`.

**Target:** reach `snr_db >= 20.0`.

## Evaluation contract

`code/evaluate.py`:

- builds a fixed clean signal and a fixed noisy signal (fixed seed)
- calls `apply_filter(noisy)` from `code/filter.py`
- computes SNR in dB against the clean signal
- prints `{"score": snr_db, "valid": true, "metrics": {"snr_db": snr_db}}`

`valid` is `false` if the filter output length differs from the input length.
Do not change the signal generation or the SNR computation — only edit
`filter.py`.
