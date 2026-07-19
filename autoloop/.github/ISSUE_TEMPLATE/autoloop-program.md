---
name: Autoloop program
about: Request an Autoloop optimization run on a program
title: "autoloop: <program-name>"
labels: ["autoloop-program"]
assignees: []
---

<!--
Fill in the fields below. When this issue is labeled `autoloop-program`,
the Autoloop workflow will pick it up and start an optimization run.
-->

### Program

<!-- The directory name under .autoloop/programs/ to optimize.
     One of: function_minimization, signal_processing, circle_packing, autoresearch
     (or a new program you have added). -->

program: function_minimization

### Iterations

<!-- How many improvement iterations to attempt. -->

iterations: 10

### Notes / constraints

<!-- Optional. Anything the loop should know: extra constraints, ideas to try,
     or areas to avoid. Do NOT ask it to modify the evaluator. -->
