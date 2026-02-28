.PHONY: tui-sandbox-all

tui-sandbox-all:
	OPENCODE_SANDBOX_USE_REAL_AUTH=1 bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-suite.sh
