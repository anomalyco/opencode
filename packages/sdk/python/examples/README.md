# Examples

Requires Python 3.10+ and the SDK installed:

```bash
cd packages/sdk/python
py -3.13 -m venv .venv            # or python3 -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS/Linux
pip install -e .
```

## simple_chat.py

Start a server, send a prompt, print the response.

```bash
python examples/simple_chat.py
```

## code_review.py

Review the latest git diff of any repository.

```bash
# Review the last commit diff in the current repo
python examples/code_review.py

# Review against a specific revision
python examples/code_review.py --base HEAD~3

# Point to another repository
python examples/code_review.py --repo-path C:\Projects\my-app
```
