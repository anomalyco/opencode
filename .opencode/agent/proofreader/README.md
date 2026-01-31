Proofreader agent

This is a lightweight proofreading tool intended to run locally before posting long comments to GitHub. It helps catch common formatting mistakes like literal "\n" sequences (escaped newlines), trailing whitespace, and excessive consecutive spaces.

Usage:

- Pipe content to the tool:

  cat comment.txt | node tools/proofreader.js

- Auto-fix common issues and output fixed text to stdout:

  cat comment.txt | node tools/proofreader.js --fix

- Fix a file in place:

  node tools/proofreader.js --fix comment.txt

Integration:

- Add a step in your local workflow to run the proofreader before creating long GitHub comments.
- In CI, you can run the tool to validate generated content before submitting automated comments.

